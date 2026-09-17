from getpass import getpass

from django.core.management.base import BaseCommand, CommandError

from accounts.models import MIN_PASSWORD_LENGTH, User


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
        if len(password) < MIN_PASSWORD_LENGTH:
            raise CommandError(f'Password must be at least {MIN_PASSWORD_LENGTH} characters.')
        user.set_password(password)
        user.save(update_fields=['password_hash'])
        self.stdout.write(f'Password updated for "{username}". Existing sessions are signed out.')
