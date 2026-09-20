from django.http import HttpResponse, JsonResponse
from django.views import View

from accounts.auth import current_user
from accounts.models import utcnow
from config.views import read_json

from .models import VALID_STATUSES, Job
from .validators import (
    MAX_COMPANY,
    MAX_NAME,
    MAX_SALARY,
    clean_link,
    clean_link_for_update,
    clean_text,
)


class JobListView(View):
    def get(self, request):
        jobs = Job.objects.filter(user=current_user(request)).order_by('-created_at')
        return JsonResponse([j.to_dict() for j in jobs], safe=False)

    def post(self, request):
        data = read_json(request)
        name = clean_text(data.get('name'), MAX_NAME)
        company = clean_text(data.get('company'), MAX_COMPANY)
        if not name:
            return JsonResponse({'error': 'Job title is required'}, status=400)
        if not company:
            return JsonResponse({'error': 'Company is required'}, status=400)
        link, error = clean_link(data.get('link'))
        if error:
            return JsonResponse({'error': error}, status=400)

        job = Job.objects.create(
            user=current_user(request),
            name=name,
            company=company,
            link=link,
            salary=clean_text(data.get('salary'), MAX_SALARY),
            status='to_be_applied',
        )
        return JsonResponse(job.to_dict(), status=201)


class JobDetailView(View):
    http_method_names = ['patch', 'delete']

    def dispatch(self, request, *args, job_id, **kwargs):
        if request.method.lower() not in self.http_method_names:
            return self.http_method_not_allowed(request)
        # Scoped to the owner, and a miss is a 404 rather than a 403 so the
        # response doesn't reveal whether someone else's job has that id.
        self.job = Job.objects.filter(pk=job_id, user=current_user(request)).first()
        if self.job is None:
            return JsonResponse({'error': 'Job not found'}, status=404)
        return super().dispatch(request, *args, **kwargs)

    def patch(self, request):
        job = self.job
        data = read_json(request)

        if data.get('status') in VALID_STATUSES:
            job.status = data['status']
            if data['status'] == 'applied':
                job.applied_date = utcnow()
            if data['status'] == 'in_interview':
                job.had_interview = True
        if 'name' in data:
            name = clean_text(data['name'], MAX_NAME)
            if not name:
                return JsonResponse({'error': 'Job title is required'}, status=400)
            job.name = name
        if 'company' in data:
            job.company = clean_text(data['company'], MAX_COMPANY)
        if 'link' in data:
            link, error = clean_link_for_update(data['link'], job.link)
            if error:
                return JsonResponse({'error': error}, status=400)
            job.link = link
        if 'salary' in data:
            job.salary = clean_text(data['salary'], MAX_SALARY)
        if 'had_interview' in data:
            job.had_interview = bool(data['had_interview'])

        job.save()
        return JsonResponse(job.to_dict())

    def delete(self, request):
        self.job.delete()
        return HttpResponse(status=204)
