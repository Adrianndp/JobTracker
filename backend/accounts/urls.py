from django.urls import path

from . import views

urlpatterns = [
    path('status', views.StatusView.as_view()),
    path('logout', views.LogoutView.as_view()),
    path('token', views.TokenView.as_view()),
    path('tokens', views.TokenListView.as_view()),
    path('tokens/<int:token_id>', views.TokenDetailView.as_view()),
]
