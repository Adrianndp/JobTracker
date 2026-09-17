from django.http import HttpResponse, JsonResponse
from django.views import View

from accounts.models import utcnow
from config.views import read_json

from .models import VALID_STATUSES, Job


def optional_str(value):
    return value.strip() or None if isinstance(value, str) else None


class JobListView(View):
    def get(self, request):
        jobs = Job.objects.order_by('-created_at')
        return JsonResponse([j.to_dict() for j in jobs], safe=False)

    def post(self, request):
        data = read_json(request)
        name = optional_str(data.get('name'))
        company = optional_str(data.get('company'))
        if not name:
            return JsonResponse({'error': 'Job title is required'}, status=400)
        if not company:
            return JsonResponse({'error': 'Company is required'}, status=400)

        job = Job.objects.create(
            name=name,
            company=company,
            link=data.get('link') or None,
            salary=data.get('salary') or None,
            status='to_be_applied',
        )
        return JsonResponse(job.to_dict(), status=201)


class JobDetailView(View):
    http_method_names = ['patch', 'delete']

    def dispatch(self, request, *args, job_id, **kwargs):
        if request.method.lower() not in self.http_method_names:
            return self.http_method_not_allowed(request)
        self.job = Job.objects.filter(pk=job_id).first()
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
            name = optional_str(data['name'])
            if not name:
                return JsonResponse({'error': 'Job title is required'}, status=400)
            job.name = name
        if 'company' in data:
            job.company = data['company'] or None
        if 'link' in data:
            job.link = data['link'] or None
        if 'salary' in data:
            job.salary = data['salary'] or None
        if 'had_interview' in data:
            job.had_interview = bool(data['had_interview'])

        job.save()
        return JsonResponse(job.to_dict())

    def delete(self, request):
        self.job.delete()
        return HttpResponse(status=204)
