#!/usr/bin/env python
import os
import sys


def main():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
    from django.core.management import execute_from_command_line
    from django.core.management.commands.runserver import Command as RunserverCommand

    # The Vite dev proxy and docker-compose expect the API on port 5001
    RunserverCommand.default_port = '5001'
    execute_from_command_line(sys.argv)


if __name__ == '__main__':
    main()
