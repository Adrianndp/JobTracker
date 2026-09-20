from getpass import getpass

from django.contrib.auth import password_validation
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from accounts.models import User


class Command(BaseCommand):
    help = 'Set a new password for an existing account.'

    def add_arguments(self, parser):
        parser.add_argument('--username')

    def handle(self, *args, username=None, **options):
        username = username or input('Username: ')
        user = User.objects.filter(username=username).first()
        if user is None:
            raise CommandError(f'No account named "{username}".')
        password = getpass('Password: ')
        if getpass('Repeat for confirmation: ') != password:
            raise CommandError('The two entered values do not match.')
        try:
            password_validation.validate_password(password, user)
        except ValidationError as exc:
            raise CommandError(' '.join(exc.messages))
        user.set_password(password)
        user.save(update_fields=['password_hash'])
        self.stdout.write(
            f'Password updated for "{username}". Existing sessions and API tokens are signed out.'
        )
