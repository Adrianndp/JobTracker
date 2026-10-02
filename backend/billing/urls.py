from django.urls import path

from . import views

urlpatterns = [
    path('plans', views.PlansView.as_view()),
    path('status', views.StatusView.as_view()),
    path('preview', views.PreviewView.as_view()),
    path('details', views.DetailsView.as_view()),
    path('invoices/<str:transaction_id>', views.InvoiceView.as_view()),
    path('checkout', views.CheckoutView.as_view()),
    path('portal', views.PortalView.as_view()),
    path('webhook', views.WebhookView.as_view()),
]
