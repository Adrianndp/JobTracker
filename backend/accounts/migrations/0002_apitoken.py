import accounts.models
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='ApiToken',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('token_hash', models.CharField(db_index=True, max_length=64, unique=True)),
                ('prefix', models.CharField(max_length=8)),
                ('device_name', models.CharField(max_length=80, null=True)),
                ('session_version', models.CharField(max_length=32)),
                ('created_at', models.DateTimeField(default=accounts.models.utcnow)),
                ('last_used_at', models.DateTimeField(null=True)),
                ('expires_at', models.DateTimeField()),
                ('revoked_at', models.DateTimeField(null=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                           related_name='api_tokens', to='accounts.user')),
            ],
            options={
                'db_table': 'api_token',
            },
        ),
    ]
