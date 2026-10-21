// Checks a database structure file made by engine/access_metadata.py (format cutover-db-metadata/1).
// Mirrors legacy.validate_metadata in the engine: a file may hold only names, types, nullability and row counts.
// Anything else is refused, so no row value can reach the report. Keep the two in step.

export const META_FORMAT = "cutover-db-metadata/1";
const META_KEYS = ["format", "database", "engine", "tables"];
const TABLE_KEYS = ["name", "columns", "row_count"];
const COLUMN_KEYS = ["name", "type", "nullable"];
export const MAX_TABLES = 5000;
export const MAX_COLUMNS = 2000;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const onlyKeys = (obj, allowed) => Object.keys(obj).every((k) => allowed.includes(k));

// Returns { value, tables, fields } on success, or { error } with a message the user can act on.
export function validateDbMetadata(doc) {
  if (!isPlainObject(doc) || !onlyKeys(doc, META_KEYS) || doc.format !== META_FORMAT) {
    return { error: "Not a Cutover database structure file. Use the file made by access_metadata.py." };
  }
  if (typeof doc.database !== "string" || doc.database.length === 0 || doc.database.length > 260) {
    return { error: "The file needs a database file name." };
  }
  if (doc.engine !== undefined && (typeof doc.engine !== "string" || doc.engine.length > 100)) {
    return { error: "The engine name is too long." };
  }
  if (!Array.isArray(doc.tables) || doc.tables.length > MAX_TABLES) {
    return { error: "The file needs a list of tables." };
  }
  let fields = 0;
  for (const t of doc.tables) {
    if (!isPlainObject(t) || !onlyKeys(t, TABLE_KEYS)) {
      return { error: "A table entry holds fields that a structure file may not contain." };
    }
    if (typeof t.name !== "string" || t.name.length < 1 || t.name.length > 128) {
      return { error: "A table needs a name of up to 128 characters." };
    }
    if (t.row_count !== undefined && t.row_count !== null && (!Number.isInteger(t.row_count) || t.row_count < 0)) {
      return { error: "A row count must be a whole number or empty." };
    }
    if (!Array.isArray(t.columns) || t.columns.length > MAX_COLUMNS) {
      return { error: "A table needs a list of fields." };
    }
    for (const c of t.columns) {
      if (!isPlainObject(c) || !onlyKeys(c, COLUMN_KEYS)) {
        return { error: "A field entry holds fields that a structure file may not contain." };
      }
      if (typeof c.name !== "string" || c.name.length < 1 || c.name.length > 128) {
        return { error: "A field needs a name of up to 128 characters." };
      }
      if (typeof c.type !== "string" || c.type.length > 40) {
        return { error: "A field needs a type name." };
      }
      if (typeof c.nullable !== "boolean") {
        return { error: "A field's nullable flag must be true or false." };
      }
      fields += 1;
    }
  }
  return { value: doc, tables: doc.tables.length, fields };
}
