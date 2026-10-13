# Generated for the synthetic Epic-style test application (fixtures/synthetic-epic-app).
# Source findings used:
#   runtime.spring_boot = 2.7.18, runtime.java = 11
#   data.database_engines = SQL Server, data.migrations = Flyway (2 scripts)
#   containers.images: base image is pinned by tag only (review before production)
#   infrastructure.as_code: none found in the source (this file is the target design)
# Generate-only: review with `terraform plan` before applying. Nothing here stores a password.

locals {
  name = "${var.prefix}-${var.environment}"
  tags = merge(
    {
      application = "synthetic-epic-app"
      environment = var.environment
      managed_by  = "cutover-generate"
    },
    var.tags,
  )
}

resource "random_string" "suffix" {
  length  = 5
  upper   = false
  special = false
}

resource "azurerm_resource_group" "app" {
  name     = "rg-${local.name}"
  location = var.location
  tags     = local.tags
}

# ---------------------------------------------------------------- network

resource "azurerm_virtual_network" "app" {
  name                = "vnet-${local.name}"
  location            = azurerm_resource_group.app.location
  resource_group_name = azurerm_resource_group.app.name
  address_space       = var.address_space
  tags                = local.tags
}

resource "azurerm_subnet" "app_integration" {
  name                 = "snet-app-integration"
  resource_group_name  = azurerm_resource_group.app.name
  virtual_network_name = azurerm_virtual_network.app.name
  address_prefixes     = [cidrsubnet(var.address_space[0], 8, 1)]

  delegation {
    name = "app-service"

    service_delegation {
      name    = "Microsoft.Web/serverFarms"
      actions = ["Microsoft.Network/virtualNetworks/subnets/action"]
    }
  }
}

resource "azurerm_subnet" "private_endpoints" {
  name                              = "snet-private-endpoints"
  resource_group_name               = azurerm_resource_group.app.name
  virtual_network_name              = azurerm_virtual_network.app.name
  address_prefixes                  = [cidrsubnet(var.address_space[0], 8, 2)]
  private_endpoint_network_policies = "Enabled"
}

# ---------------------------------------------------------------- database

resource "azurerm_mssql_server" "db" {
  name                          = "sql-${local.name}-${random_string.suffix.result}"
  resource_group_name           = azurerm_resource_group.app.name
  location                      = azurerm_resource_group.app.location
  version                       = "12.0"
  minimum_tls_version           = "1.2"
  public_network_access_enabled = false
  tags                          = local.tags

  azuread_administrator {
    login_username              = var.sql_admin_group_name
    object_id                   = var.sql_admin_group_object_id
    azuread_authentication_only = true
  }
}

resource "azurerm_mssql_database" "portal" {
  name                 = "portal"
  server_id            = azurerm_mssql_server.db.id
  sku_name             = var.sql_database_sku
  zone_redundant       = false
  tags                 = local.tags

  short_term_retention_policy {
    retention_days = 7
  }
}

resource "azurerm_private_dns_zone" "sql" {
  name                = "privatelink.database.windows.net"
  resource_group_name = azurerm_resource_group.app.name
  tags                = local.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "sql" {
  name                  = "link-sql-${local.name}"
  resource_group_name   = azurerm_resource_group.app.name
  private_dns_zone_name = azurerm_private_dns_zone.sql.name
  virtual_network_id    = azurerm_virtual_network.app.id
  tags                  = local.tags
}

resource "azurerm_private_endpoint" "sql" {
  name                = "pe-sql-${local.name}"
  location            = azurerm_resource_group.app.location
  resource_group_name = azurerm_resource_group.app.name
  subnet_id           = azurerm_subnet.private_endpoints.id
  tags                = local.tags

  private_service_connection {
    name                           = "psc-sql-${local.name}"
    private_connection_resource_id = azurerm_mssql_server.db.id
    subresource_names              = ["sqlServer"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "sql-dns"
    private_dns_zone_ids = [azurerm_private_dns_zone.sql.id]
  }
}

# ---------------------------------------------------------------- application

resource "azurerm_service_plan" "app" {
  name                = "asp-${local.name}"
  resource_group_name = azurerm_resource_group.app.name
  location            = azurerm_resource_group.app.location
  os_type             = "Linux"
  sku_name            = var.app_service_sku
  tags                = local.tags
}

resource "azurerm_linux_web_app" "portal" {
  name                      = "app-${local.name}-${random_string.suffix.result}"
  resource_group_name       = azurerm_resource_group.app.name
  location                  = azurerm_resource_group.app.location
  service_plan_id           = azurerm_service_plan.app.id
  https_only                = true
  virtual_network_subnet_id = azurerm_subnet.app_integration.id
  tags                      = local.tags

  identity {
    type = "SystemAssigned"
  }

  site_config {
    always_on              = true
    ftps_state             = "Disabled"
    http2_enabled          = true
    minimum_tls_version    = "1.2"
    vnet_route_all_enabled = true

    application_stack {
      java_server         = "JAVA"
      java_server_version = "SE"
      java_version        = "11"
    }
  }

  app_settings = {
    "WEBSITE_RUN_FROM_PACKAGE" = "1"
    "SPRING_PROFILES_ACTIVE"   = "azure"
    # Connects with the app's managed identity, so no password is stored anywhere.
    "SPRING_DATASOURCE_URL" = "jdbc:sqlserver://${azurerm_mssql_server.db.fully_qualified_domain_name}:1433;database=${azurerm_mssql_database.portal.name};encrypt=true;authentication=ActiveDirectoryMSI"
  }
}
