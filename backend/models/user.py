import hashlib
import hmac
from datetime import datetime

from flask import current_app
from werkzeug.security import check_password_hash, generate_password_hash

from extensions import db

MIN_PASSWORD_LENGTH = 8


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(255), unique=True, nullable=True)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def session_version(self):
        # Changes whenever the password changes, which invalidates existing sessions
        key = current_app.secret_key.encode()
        return hmac.new(key, self.password_hash.encode(), hashlib.sha256).hexdigest()[:16]
