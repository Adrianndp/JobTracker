from django.db import migrations


class Migration(migrations.Migration):
    """Rename the hand-rolled columns to AbstractUser's names.

    Written by hand, before the generated 0004 adds the rest: the autodetector
    can mistake a rename for a drop plus an add, which would lose every password.
    """

    dependencies = [
        ('accounts', '0002_apitoken'),
    ]

    operations = [
        migrations.RenameField('user', 'password_hash', 'password'),
        migrations.RenameField('user', 'created_at', 'date_joined'),
    ]
