# Azure target (App Service, private SQL Server)

Generated for the synthetic test application. Generate-only: review, then apply yourself.

## Before you apply
1. Install Terraform 1.6 or later, and sign in with `az login`.
2. Set `ARM_SUBSCRIPTION_ID` to a sandbox subscription. Never point this at production.
3. Copy `terraform.tfvars.example` to `terraform.tfvars` and fill in the Entra admin group.
4. Run `terraform init`, then `terraform plan`. Review every change before you approve it.

## After the first apply (database access)
The app connects with its managed identity, so a database user has to be created once. Run this as the
Entra admin, using the `app_managed_identity_principal_id` output to find the identity:

    CREATE USER [app-<name>-<suffix>] FROM EXTERNAL PROVIDER;
    ALTER ROLE db_datareader ADD MEMBER [app-<name>-<suffix>];
    ALTER ROLE db_datawriter ADD MEMBER [app-<name>-<suffix>];
    ALTER ROLE db_ddladmin ADD MEMBER [app-<name>-<suffix>];   -- only if Flyway runs at app start

Use the app's name as shown in the Azure portal. Grant the least privilege the app needs.

## Not in this version
- Deploying the application JAR (use a pipeline with `WEBSITE_RUN_FROM_PACKAGE`)
- Key Vault, Application Insights, and a custom domain with TLS
- Pinning the container or runtime base image by digest (the source image is pinned by tag only)
- Validation with `terraform validate` and a plan against a sandbox subscription. This has not been run yet.
