from django.core.management.base import BaseCommand, CommandError

from accounts.models import User
from billing.models import BillingAccount


class Command(BaseCommand):
    help = 'Give an account Pro without a subscription (your own, testers), or take it away.'

    def add_arguments(self, parser):
        parser.add_argument('email')
        parser.add_argument('--off', action='store_true', help='Remove complimentary Pro')

    def handle(self, email, off, **options):
        user = User.objects.filter(email__iexact=email).first()
        if user is None:
            raise CommandError(f'No account with email {email}')
        account, _ = BillingAccount.objects.get_or_create(user=user)
        account.complimentary = not off
        account.save(update_fields=['complimentary'])
        state = 'no longer has' if off else 'now has'
        self.stdout.write(f'{user.email} {state} complimentary Pro.')
