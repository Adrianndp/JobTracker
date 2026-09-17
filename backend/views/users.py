import re
import time

import click
from flask import Blueprint, jsonify, request, session

from extensions import db
from models import User
from models.user import MIN_PASSWORD_LENGTH

# cli_group=None registers commands at the top level: `flask --app app reset-password`
bp = Blueprint('users', __name__, url_prefix='/api/auth', cli_group=None)

PUBLIC_API_PATHS = {'/api/health', '/api/auth/status', '/api/auth/signup', '/api/auth/login', '/api/auth/logout'}
MAX_FAILED_LOGINS = 5
LOCKOUT_SECONDS = 300
failed_logins = {}

EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


def current_user():
    user_id = session.get('user_id')
    if user_id is None:
        return None
    user = db.session.get(User, user_id)
    if user is None or session.get('session_version') != user.session_version():
        return None
    return user


def start_session(user):
    session.clear()
    session.permanent = True
    session['user_id'] = user.id
    session['session_version'] = user.session_version()


def read_credentials():
    data = request.get_json(silent=True) or {}
    username = data.get('username')
    password = data.get('password')
    username = username.strip() if isinstance(username, str) else ''
    password = password if isinstance(password, str) else ''
    return username, password


def read_email():
    data = request.get_json(silent=True) or {}
    email = data.get('email')
    return email.strip() if isinstance(email, str) else ''


@bp.before_app_request
def require_login():
    if not request.path.startswith('/api/'):
        return None
    # Only JSON bodies are accepted, so cross-site HTML forms can't hit the API
    if request.method in ('POST', 'PATCH', 'PUT') and not request.is_json:
        return jsonify({'error': 'Content-Type must be application/json'}), 415
    if request.path in PUBLIC_API_PATHS:
        return None
    if current_user() is None:
        return jsonify({'error': 'Authentication required'}), 401
    return None


@bp.route('/status', methods=['GET'])
def status():
    user = current_user()
    return jsonify({
        'authenticated': user is not None,
        'username': user.username if user else None,
        'setup_required': User.query.first() is None,
    })


@bp.route('/signup', methods=['POST'])
def signup():
    if User.query.first() is not None:
        return jsonify({'error': 'Sign-up is closed. An account already exists.'}), 403
    username, password = read_credentials()
    email = read_email()
    if not username:
        return jsonify({'error': 'Username is required.'}), 400
    if len(username) > 80:
        return jsonify({'error': 'Username must be at most 80 characters.'}), 400
    if not email:
        return jsonify({'error': 'Email is required.'}), 400
    if len(email) > 255 or not EMAIL_RE.match(email):
        return jsonify({'error': 'Enter a valid email address.'}), 400
    if len(password) < MIN_PASSWORD_LENGTH:
        return jsonify({'error': f'Password must be at least {MIN_PASSWORD_LENGTH} characters.'}), 400

    user = User(username=username, email=email)
    user.set_password(password)
    db.session.add(user)
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({'error': 'Sign-up is closed. An account already exists.'}), 403
    # Another request may have created an account at the same moment; only the first one counts
    if User.query.order_by(User.id).first().id != user.id:
        db.session.delete(user)
        db.session.commit()
        return jsonify({'error': 'Sign-up is closed. An account already exists.'}), 403

    start_session(user)
    return jsonify({'username': user.username}), 201


@bp.route('/login', methods=['POST'])
def login():
    addr = request.remote_addr or 'unknown'
    now = time.monotonic()
    count, locked_until = failed_logins.get(addr, (0, 0))
    if locked_until > now:
        retry = int(locked_until - now) + 1
        return jsonify({'error': f'Too many failed attempts. Try again in {retry} seconds.'}), 429

    username, password = read_credentials()
    user = User.query.filter_by(username=username).first() if username else None
    if user is None or not user.check_password(password):
        count += 1
        failed_logins[addr] = (0, now + LOCKOUT_SECONDS) if count >= MAX_FAILED_LOGINS else (count, 0)
        return jsonify({'error': 'Invalid username or password.'}), 401

    failed_logins.pop(addr, None)
    start_session(user)
    return jsonify({'username': user.username})


@bp.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return '', 204


@bp.cli.command('reset-password')
@click.option('--username', prompt=True)
@click.password_option()
def reset_password(username, password):
    """Set a new password for an existing account."""
    user = User.query.filter_by(username=username).first()
    if user is None:
        raise click.ClickException(f'No account named "{username}".')
    if len(password) < MIN_PASSWORD_LENGTH:
        raise click.ClickException(f'Password must be at least {MIN_PASSWORD_LENGTH} characters.')
    user.set_password(password)
    db.session.commit()
    click.echo(f'Password updated for "{username}". Existing sessions are signed out.')
