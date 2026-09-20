#!/usr/bin/env python
import os
import sys


def main():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

    # ALLOWED_HOSTS only governs requests we serve, and most management commands
    # (migrate, shell, seed, reset_password) serve none -- so give them a local
    # default rather than making settings refuse to load. gunicorn goes through
    # wsgi.py, never here, so production still fails closed.
    os.environ.setdefault('ALLOWED_HOSTS', 'localhost,127.0.0.1,[::1],testserver')

    # runserver and test are development commands by definition. Nothing else
    # turns DEBUG on, so a production image cannot inherit it.
    if len(sys.argv) > 1 and sys.argv[1] in ('runserver', 'test'):
        os.environ.setdefault('DJANGO_DEBUG', '1')

    from django.core.management import execute_from_command_line
    from django.core.management.commands.runserver import Command as RunserverCommand

    # The Vite dev proxy and docker-compose expect the API on port 5001
    RunserverCommand.default_port = '5001'
    execute_from_command_line(sys.argv)


if __name__ == '__main__':
    main()
