from flask import Flask, jsonify, request, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from datetime import datetime, date
import os

DIST = os.path.join(os.path.dirname(__file__), 'dist')

app = Flask(__name__)
CORS(app)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///jobs.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

VALID_STATUSES = ['to_be_applied', 'applied', 'in_interview', 'rejected', 'offer', 'ghosted']


class Job(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    company = db.Column(db.String(200), nullable=True)
    link = db.Column(db.String(500), nullable=True)
    salary = db.Column(db.String(100), nullable=True)
    status = db.Column(db.String(50), default='to_be_applied')
    had_interview = db.Column(db.Boolean, default=False)
    applied_date = db.Column(db.Date, nullable=True)
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
            'applied_date': self.applied_date.isoformat() if self.applied_date else None,
            'created_at': self.created_at.isoformat(),
        }


with app.app_context():
    db.create_all()
    from sqlalchemy import text
    for col, ddl in [
        ('company', 'ALTER TABLE job ADD COLUMN company VARCHAR(200)'),
        ('had_interview', 'ALTER TABLE job ADD COLUMN had_interview BOOLEAN DEFAULT 0'),
        ('applied_date', 'ALTER TABLE job ADD COLUMN applied_date DATE'),
    ]:
        try:
            with db.engine.connect() as conn:
                conn.execute(text(ddl))
                conn.commit()
        except Exception:
            pass


@app.route('/api/jobs', methods=['GET'])
def get_jobs():
    jobs = Job.query.order_by(Job.created_at.desc()).all()
    return jsonify([j.to_dict() for j in jobs])


@app.route('/api/jobs', methods=['POST'])
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


@app.route('/api/jobs/<int:job_id>', methods=['PATCH'])
def update_job(job_id):
    job = Job.query.get_or_404(job_id)
    data = request.get_json()

    if 'status' in data and data['status'] in VALID_STATUSES:
        job.status = data['status']
        if data['status'] == 'applied':
            job.applied_date = date.today()
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


@app.route('/api/jobs/<int:job_id>', methods=['DELETE'])
def delete_job(job_id):
    job = Job.query.get_or_404(job_id)
    db.session.delete(job)
    db.session.commit()
    return '', 204


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
