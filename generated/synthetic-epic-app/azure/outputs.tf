output "resource_group_name" {
  description = "Resource group that holds the application."
  value       = azurerm_resource_group.app.name
}

output "app_default_hostname" {
  description = "Default hostname of the web app (use a custom domain and TLS in front of it for production)."
  value       = azurerm_linux_web_app.portal.default_hostname
}

output "app_managed_identity_principal_id" {
  description = "Object ID of the app's managed identity. Used for the database user step in the README."
  value       = azurerm_linux_web_app.portal.identity[0].principal_id
}

output "sql_server_fqdn" {
  description = "Private SQL Server name. Resolves only inside the application network."
  value       = azurerm_mssql_server.db.fully_qualified_domain_name
}
