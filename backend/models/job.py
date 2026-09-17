from datetime import datetime

from extensions import db

VALID_STATUSES = ['to_be_applied', 'applied', 'in_interview', 'rejected', 'offer', 'ghosted']


class Job(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    company = db.Column(db.String(200), nullable=True)
    link = db.Column(db.String(500), nullable=True)
    salary = db.Column(db.String(100), nullable=True)
    status = db.Column(db.String(50), default='to_be_applied')
    had_interview = db.Column(db.Boolean, default=False)
    applied_date = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

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
