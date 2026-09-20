import json

from django.core.cache import cache
from django.test import Client, TestCase

from accounts import tokens
from accounts.models import User

from .models import Job
from .validators import clean_link, clean_link_for_update, clean_text

JSON = 'application/json'


def make_user(username):
    user = User(username=username, email=f'{username}@example.com')
    user.set_password('correct-horse-battery-9')
    user.save()
    raw, _ = tokens.issue(user, username)
    return user, raw


class JobApiTestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.alice, self.alice_token = make_user('alice')
        self.bob, self.bob_token = make_user('bob')
        self.c = Client()

    def as_alice(self, method, path, body=None):
        return self.call(self.alice_token, method, path, body)

    def as_bob(self, method, path, body=None):
        return self.call(self.bob_token, method, path, body)

    def call(self, token, method, path, body=None):
        kwargs = {'content_type': JSON, 'HTTP_AUTHORIZATION': f'Bearer {token}'}
        if body is not None:
            kwargs['data'] = json.dumps(body)
        return getattr(self.c, method)(path, **kwargs)


class OwnershipTests(JobApiTestCase):
    def setUp(self):
        super().setUp()
        self.alice_job = Job.objects.create(user=self.alice, name='Alice role', company='ACo')
        self.bob_job = Job.objects.create(user=self.bob, name='Bob role', company='BCo')

    def test_list_only_returns_own_jobs(self):
        names = [j['name'] for j in self.as_alice('get', '/api/jobs').json()]
        self.assertEqual(names, ['Alice role'])

    def test_cannot_patch_another_users_job(self):
        r = self.as_alice('patch', f'/api/jobs/{self.bob_job.id}', {'name': 'hijacked'})
        self.assertEqual(r.status_code, 404)  # 404 not 403: no enumeration oracle
        self.bob_job.refresh_from_db()
        self.assertEqual(self.bob_job.name, 'Bob role')

    def test_cannot_delete_another_users_job(self):
        r = self.as_alice('delete', f'/api/jobs/{self.bob_job.id}')
        self.assertEqual(r.status_code, 404)
        self.assertTrue(Job.objects.filter(pk=self.bob_job.id).exists())

    def test_created_job_belongs_to_the_caller(self):
        r = self.as_alice('post', '/api/jobs', {'name': 'New', 'company': 'NCo'})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(Job.objects.get(pk=r.json()['id']).user_id, self.alice.id)

    def test_response_does_not_leak_owner(self):
        self.assertNotIn('user', self.as_alice('get', '/api/jobs').json()[0])


class LinkValidationTests(JobApiTestCase):
    def post_link(self, link):
        return self.as_alice('post', '/api/jobs', {'name': 'n', 'company': 'c', 'link': link})

    def test_dangerous_schemes_are_rejected(self):
        for link in ['javascript:alert(1)', 'data:text/html,<script>1</script>',
                     'vbscript:x', '//evil.example', 'JavaScript:alert(1)',
                     'java\tscript:alert(1)', 'easy apply']:
            with self.subTest(link=link):
                self.assertEqual(self.post_link(link).status_code, 400)

    def test_http_links_are_accepted(self):
        for link in ['https://example.com/job/1', 'http://example.com/job/1']:
            with self.subTest(link=link):
                self.assertEqual(self.post_link(link).status_code, 201)

    def test_blank_link_is_allowed(self):
        r = self.as_alice('post', '/api/jobs', {'name': 'n', 'company': 'c', 'link': ''})
        self.assertEqual(r.status_code, 201)
        self.assertIsNone(r.json()['link'])

    def test_legacy_non_url_can_be_echoed_back_unchanged(self):
        """Rows predating validation hold notes like 'easy apply'. The edit form
        submits every field, so rejecting these would make them uneditable."""
        job = Job.objects.create(user=self.alice, name='Legacy', company='C', link='easy apply')
        r = self.as_alice('patch', f'/api/jobs/{job.id}',
                          {'name': 'Renamed', 'link': 'easy apply'})
        self.assertEqual(r.status_code, 200)
        job.refresh_from_db()
        self.assertEqual(job.link, 'easy apply')
        self.assertEqual(job.name, 'Renamed')

    def test_legacy_row_still_rejects_a_new_dangerous_link(self):
        job = Job.objects.create(user=self.alice, name='Legacy', company='C', link='easy apply')
        r = self.as_alice('patch', f'/api/jobs/{job.id}', {'link': 'javascript:alert(1)'})
        self.assertEqual(r.status_code, 400)
        job.refresh_from_db()
        self.assertEqual(job.link, 'easy apply')


class LengthCapTests(JobApiTestCase):
    def test_oversized_text_is_truncated_not_stored_whole(self):
        """SQLite doesn't enforce VARCHAR(n) and create() doesn't check it."""
        r = self.as_alice('post', '/api/jobs', {'name': 'x' * 5000, 'company': 'y' * 5000})
        self.assertEqual(r.status_code, 201)
        job = Job.objects.get(pk=r.json()['id'])
        self.assertEqual(len(job.name), 200)
        self.assertEqual(len(job.company), 200)

    def test_oversized_link_is_rejected(self):
        link = 'https://example.com/' + 'a' * 600
        r = self.as_alice('post', '/api/jobs', {'name': 'n', 'company': 'c', 'link': link})
        self.assertEqual(r.status_code, 400)

    def test_whitespace_is_collapsed(self):
        r = self.as_alice('post', '/api/jobs', {'name': '  Senior\n\tEngineer  ', 'company': 'C'})
        self.assertEqual(r.json()['name'], 'Senior Engineer')


class ValidatorUnitTests(TestCase):
    def test_clean_text_returns_none_for_empty(self):
        self.assertIsNone(clean_text('   ', 200))
        self.assertIsNone(clean_text(None, 200))

    def test_clean_link_strips_and_validates(self):
        self.assertEqual(clean_link('  https://example.com  '), ('https://example.com', None))
        self.assertIsNone(clean_link('javascript:alert(1)')[0])
        self.assertIsNotNone(clean_link('javascript:alert(1)')[1])

    def test_clean_link_for_update_only_tolerates_an_exact_match(self):
        self.assertEqual(clean_link_for_update('easy apply', 'easy apply'), ('easy apply', None))
        self.assertIsNotNone(clean_link_for_update('easy apply', 'easyApply')[1])
        self.assertIsNotNone(clean_link_for_update('easy apply', None)[1])
