from flask import Flask, jsonify, request
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from datetime import datetime
import os

app = Flask(__name__)
CORS(app)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///jobs.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

VALID_STATUSES = ['to_be_applied', 'applied', 'in_interview', 'rejected', 'offer']


class Job(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    link = db.Column(db.String(500), nullable=True)
    salary = db.Column(db.String(100), nullable=True)
    status = db.Column(db.String(50), default='to_be_applied')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'link': self.link,
            'salary': self.salary,
            'status': self.status,
            'created_at': self.created_at.isoformat(),
        }


with app.app_context():
    db.create_all()


@app.route('/api/jobs', methods=['GET'])
def get_jobs():
    jobs = Job.query.order_by(Job.created_at.desc()).all()
    return jsonify([j.to_dict() for j in jobs])


@app.route('/api/jobs', methods=['POST'])
def create_job():
    data = request.get_json()
    if not data or not data.get('name', '').strip():
        return jsonify({'error': 'Job title is required'}), 400

    job = Job(
        name=data['name'].strip(),
        link=data.get('link') or None,
        salary=data.get('salary') or None,
        status='to_be_applied',
    )
    db.session.add(job)
    db.session.commit()
    return jsonify(job.to_dict()), 201


@app.route('/api/jobs/<int:job_id>', methods=['PATCH'])
def update_job(job_id):
    job = Job.query.get_or_404(job_id)
    data = request.get_json()

    if 'status' in data and data['status'] in VALID_STATUSES:
        job.status = data['status']
    if 'name' in data:
        job.name = data['name']
    if 'link' in data:
        job.link = data['link'] or None
    if 'salary' in data:
        job.salary = data['salary'] or None

    db.session.commit()
    return jsonify(job.to_dict())


@app.route('/api/jobs/<int:job_id>', methods=['DELETE'])
def delete_job(job_id):
    job = Job.query.get_or_404(job_id)
    db.session.delete(job)
    db.session.commit()
    return '', 204


if __name__ == '__main__':
    app.run(debug=True, port=5001)
