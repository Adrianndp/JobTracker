from .models import User


def current_user(request):
    user_id = request.session.get('user_id')
    if user_id is None:
        return None
    user = User.objects.filter(pk=user_id).first()
    if user is None or request.session.get('session_version') != user.session_version():
        return None
    return user


def start_session(request, user):
    request.session.flush()
    request.session['user_id'] = user.id
    request.session['session_version'] = user.session_version()
