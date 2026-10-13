variable "prefix" {
  description = "Short name for the application, lowercase letters and digits only (1 to 10 characters)."
  type        = string
  default     = "riverside"

  validation {
    condition     = can(regex("^[a-z][a-z0-9]{0,9}$", var.prefix))
    error_message = "prefix must be 1 to 10 lowercase letters or digits, starting with a letter."
  }
}

variable "environment" {
  description = "Environment name, for example dev, staging or prod."
  type        = string
  default     = "staging"
}

variable "location" {
  description = "Azure region for all resources."
  type        = string
  default     = "eastus2"
}

variable "app_service_sku" {
  description = "App Service plan SKU. P1v3 or higher is needed for VNet integration with private endpoints."
  type        = string
  default     = "P1v3"
}

variable "sql_database_sku" {
  description = "Azure SQL database SKU."
  type        = string
  default     = "S1"
}

variable "sql_admin_group_name" {
  description = "Display name of the Microsoft Entra group that administers SQL Server."
  type        = string
}

variable "sql_admin_group_object_id" {
  description = "Object ID (GUID) of the Microsoft Entra group that administers SQL Server."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", var.sql_admin_group_object_id))
    error_message = "sql_admin_group_object_id must be a GUID."
  }
}

variable "address_space" {
  description = "Address space for the application network."
  type        = list(string)
  default     = ["10.40.0.0/16"]
}

variable "tags" {
  description = "Extra tags to apply to every resource."
  type        = map(string)
  default     = {}
}
