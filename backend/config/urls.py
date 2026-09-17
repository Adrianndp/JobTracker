from django.urls import include, path, re_path

from . import views

urlpatterns = [
    path('api/health', views.HealthView.as_view()),
    path('api/auth/', include('accounts.urls')),
    path('api/', include('jobs.urls')),
    re_path(r'^api/', views.ApiNotFoundView.as_view()),
    # Serve React in production (must be last — catches everything not matched above)
    re_path(r'^(?P<path>.*)$', views.ReactAppView.as_view()),
]
