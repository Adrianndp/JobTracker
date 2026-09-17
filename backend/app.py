import os
import secrets
import time
from datetime import timedelta

from flask import Flask, jsonify, send_from_directory
from sqlalchemy import text

from extensions import db
from models import Job, User, VALID_STATUSES
from views import jobs_bp, users_bp

__all__ = ['app', 'db', 'Job', 'User', 'VALID_STATUSES']

DIST = os.path.join(os.path.dirname(__file__), 'dist')

app = Flask(__name__)


def load_secret_key():
    if os.environ.get('SECRET_KEY'):
        return os.environ['SECRET_KEY']
    os.makedirs(app.instance_path, exist_ok=True)
    path = os.path.join(app.instance_path, 'secret_key')
    try:
        # O_EXCL so concurrent gunicorn workers can't each write a different key
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as f:
            f.write(secrets.token_hex(32))
    except FileExistsError:
        pass
    for _ in range(50):
        with open(path) as f:
            key = f.read().strip()
        if key:
            return key
        time.sleep(0.01)
    raise RuntimeError(f'Secret key file {path} is empty')


app.config.update(
    SQLALCHEMY_DATABASE_URI='sqlite:///jobs.db',
    SQLALCHEMY_TRACK_MODIFICATIONS=False,
    SECRET_KEY=load_secret_key(),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=os.environ.get('SESSION_COOKIE_SECURE') == '1',
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
)

db.init_app(app)
app.register_blueprint(users_bp)
app.register_blueprint(jobs_bp)

with app.app_context():
    db.create_all()
    for ddl in [
        'ALTER TABLE job ADD COLUMN company VARCHAR(200)',
        'ALTER TABLE job ADD COLUMN had_interview BOOLEAN DEFAULT 0',
        'ALTER TABLE job ADD COLUMN applied_date DATE',
        'ALTER TABLE user ADD COLUMN email VARCHAR(255)',
    ]:
        try:
            with db.engine.connect() as conn:
                conn.execute(text(ddl))
                conn.commit()
        except Exception:
            pass


@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})


# Serve React in production (must be last — catches everything not matched above)
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_react(path):
    if os.path.exists(DIST):
        file = os.path.join(DIST, path)
        if path and os.path.exists(file):
            return send_from_directory(DIST, path)
        return send_from_directory(DIST, 'index.html')
    return jsonify({'error': 'Frontend not built'}), 404


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    debug = os.environ.get('FLASK_ENV') != 'production'
    app.run(host='0.0.0.0', port=port, debug=debug)
