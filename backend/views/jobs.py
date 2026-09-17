from datetime import datetime

from flask import Blueprint, jsonify, request

from extensions import db
from models import Job, VALID_STATUSES

bp = Blueprint('jobs', __name__, url_prefix='/api/jobs')


@bp.route('', methods=['GET'])
def list_jobs():
    jobs = Job.query.order_by(Job.created_at.desc()).all()
    return jsonify([j.to_dict() for j in jobs])


@bp.route('', methods=['POST'])
def create_job():
    data = request.get_json()
    if not data or not data.get('name', '').strip():
        return jsonify({'error': 'Job title is required'}), 400
    if not data.get('company', '').strip():
        return jsonify({'error': 'Company is required'}), 400

    job = Job(
        name=data['name'].strip(),
        company=data['company'].strip(),
        link=data.get('link') or None,
        salary=data.get('salary') or None,
        status='to_be_applied',
    )
    db.session.add(job)
    db.session.commit()
    return jsonify(job.to_dict()), 201


@bp.route('/<int:job_id>', methods=['PATCH'])
def update_job(job_id):
    job = Job.query.get_or_404(job_id)
    data = request.get_json()

    if 'status' in data and data['status'] in VALID_STATUSES:
        job.status = data['status']
        if data['status'] == 'applied':
            job.applied_date = datetime.utcnow()
        if data['status'] == 'in_interview':
            job.had_interview = True
    if 'name' in data:
        job.name = data['name']
    if 'company' in data:
        job.company = data['company'] or None
    if 'link' in data:
        job.link = data['link'] or None
    if 'salary' in data:
        job.salary = data['salary'] or None
    if 'had_interview' in data:
        job.had_interview = bool(data['had_interview'])

    db.session.commit()
    return jsonify(job.to_dict())


@bp.route('/<int:job_id>', methods=['DELETE'])
def delete_job(job_id):
    job = Job.query.get_or_404(job_id)
    db.session.delete(job)
    db.session.commit()
    return '', 204
