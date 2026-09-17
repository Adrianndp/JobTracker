from django.db import models

from accounts.models import utcnow

VALID_STATUSES = ['to_be_applied', 'applied', 'in_interview', 'rejected', 'offer', 'ghosted']


class Job(models.Model):
    name = models.CharField(max_length=200)
    company = models.CharField(max_length=200, null=True)
    link = models.CharField(max_length=500, null=True)
    salary = models.CharField(max_length=100, null=True)
    status = models.CharField(max_length=50, default='to_be_applied', null=True)
    had_interview = models.BooleanField(default=False, null=True)
    applied_date = models.DateTimeField(null=True)
    created_at = models.DateTimeField(default=utcnow, null=True)

    class Meta:
        db_table = 'job'

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'company': self.company,
            'link': self.link,
            'salary': self.salary,
            'status': self.status,
            'had_interview': self.had_interview,
            'applied_date': self.applied_date.isoformat() + 'Z' if self.applied_date else None,
            'created_at': self.created_at.isoformat(),
        }
