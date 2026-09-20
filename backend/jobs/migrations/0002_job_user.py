from django.db import migrations, models
import django.db.models.deletion


def backfill_owner(apps, schema_editor):
    """Give every existing job to the first account.

    The app has only ever supported one account (sign-up closes after the first),
    so "every job" and "that account's jobs" have always been the same set. This
    just writes that down.
    """
    Job = apps.get_model('jobs', 'Job')
    User = apps.get_model('accounts', 'User')

    orphans = Job.objects.filter(user_id__isnull=True)
    if not orphans.exists():
        return

    owner = User.objects.order_by('id').first()
    if owner is None:
        raise RuntimeError(
            f'{orphans.count()} jobs exist but there is no account to own them. '
            'Create the account first, then re-run this migration.'
        )
    orphans.update(user_id=owner.id)


class Migration(migrations.Migration):

    dependencies = [
        ('jobs', '0001_initial'),
        ('accounts', '0001_initial'),
    ]

    operations = [
        # Added nullable, backfilled, then tightened: SQLite cannot add a NOT NULL
        # column to a populated table in one step.
        migrations.AddField(
            model_name='job',
            name='user',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE,
                                    related_name='jobs', to='accounts.user', db_column='user_id'),
        ),
        migrations.RunPython(backfill_owner, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='job',
            name='user',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                    related_name='jobs', to='accounts.user', db_column='user_id'),
        ),
    ]
