from app import app, db, Job

jobs = [
    # ── To Be Applied ────────────────────────────────────────────────────────
    {
        'name': 'Romenlang – Softwareentwickler Fullstack',
        'link': 'https://jobs.rommelag.com/Softwareentwickler-Fullstack-mwd-de-j1095.html',
        'salary': None,
        'status': 'to_be_applied',
    },
    {
        'name': 'Kenbun – Software Developer Python',
        'link': 'https://www.kenbun.de/job/software-developer-python-in-kundenprojekten-w-m-d-karlsruhe-stuttgart-mannheim-und-umgebung-ggfs-remote/',
        'salary': None,
        'status': 'to_be_applied',
    },
    {
        'name': 'Precode',
        'link': 'http://prenode.jobs.personio.de/job/1597523',
        'salary': None,
        'status': 'to_be_applied',
    },
    {
        'name': 'Capgemini – SAP BTP',
        'link': 'https://www.capgemini.com/de-de/jobs/340876-de_DE+sap_btp/',
        'salary': None,
        'status': 'to_be_applied',
    },

    # ── Applied ──────────────────────────────────────────────────────────────
    {
        'name': 'CAS – Full Stack Developer',
        'link': 'https://www.cas-mitgestalter.de/jobs/full-stack-developer-w-m-d/',
        'salary': None,
        'status': 'applied',
    },
    {
        'name': 'Teleclinic – Django Developer (remote)',
        'link': 'https://zrg.wd3.myworkdayjobs.com/de-DE/teleclinic-jobs/userHome',
        'salary': None,
        'status': 'applied',
    },
    {
        'name': 'Planta – Software Developer (Database / Python)',
        'link': 'https://www.planta.de/en/software-developer-m-f-x-database-python/',
        'salary': None,
        'status': 'applied',
    },
    {
        'name': 'Matomo – Full Stack Engineer (Innovation Team)',
        'link': 'https://matomo.org/jobs/full-stack-engineer-innovation-team/',
        'salary': None,
        'status': 'applied',
    },
    {
        'name': 'Tenhil GmbH & Co. KG – Senior Python Engineer',
        'link': 'https://www.stellenanzeigen.de/job/senior-python-engineer-m-w-d-leipzig-muenchen-sde-92912/',
        'salary': '66k',
        'status': 'applied',
    },
    {
        'name': 'Andrena – Softwareentwickler',
        'link': 'https://andrena.softgarden.io/job/62480564/Softwareentwickler-w-m-d-',
        'salary': '64k',
        'status': 'applied',
    },

    # ── In Interview Process ─────────────────────────────────────────────────
    {
        'name': 'Ratbacher / risiq – Backend Developer Python / Data Engineer',
        'link': 'https://www.ratbacher.com/de/it-jobs/backend-entwickler-python-m-w-d-data-engineer-python-46384/',
        'salary': None,
        'status': 'in_interview',
    },

    # ── Got Rejected ─────────────────────────────────────────────────────────
    {
        'name': 'Sopra Steria – Fullstack Developer',
        'link': 'https://careers.soprasteria.de/job/fullstack-developer-m-w-d-in-karlsruhe-germany-jid-3909',
        'salary': None,
        'status': 'rejected',
    },
    {
        'name': 'inovex – Software Engineer Datenprojekte',
        'link': 'https://www.inovex.de/de/karriere/stellenangebote/software-engineer-datenprojekte/',
        'salary': None,
        'status': 'rejected',
    },
    {
        'name': 'Cinemo – General Application',
        'link': 'https://careers.cinemo.com/job/1337219--general-application/',
        'salary': None,
        'status': 'rejected',
    },
]

with app.app_context():
    for data in jobs:
        job = Job(**data)
        db.session.add(job)
    db.session.commit()
    print(f'Seeded {len(jobs)} jobs successfully.')
