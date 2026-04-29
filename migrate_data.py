import sqlite3
import os

source_stock_db = r"C:\Users\JAMC\Desktop\CAPSTONE\bbdd equipo\stockvalorizado.db"
source_ventas_db = r"C:\Users\JAMC\Desktop\CAPSTONE\bbdd equipo\ventas.db"
target_db = r"C:\Users\JAMC\Desktop\CAPSTONE\Pinval_SICD_back\dev.db"

def migrate_table(source_db_path, target_db_path, table_name):
    print(f"Migrating table '{table_name}' from {source_db_path} to {target_db_path}...")
    
    if not os.path.exists(source_db_path):
        print(f"Source database {source_db_path} not found!")
        return

    con_source = sqlite3.connect(source_db_path)
    cur_source = con_source.cursor()

    con_target = sqlite3.connect(target_db_path)
    cur_target = con_target.cursor()

    # Get column names
    cur_source.execute(f"PRAGMA table_info({table_name})")
    columns_info = cur_source.fetchall()
    columns = [col[1] for col in columns_info]
    
    # We might need to wrap column names in quotes in case 'index' is a keyword
    cols_str = ", ".join([f'"{c}"' for c in columns])
    placeholders = ", ".join(["?" for _ in columns])

    # Fetch all data
    cur_source.execute(f'SELECT {cols_str} FROM "{table_name}"')
    rows = cur_source.fetchall()

    if not rows:
        print(f"No rows found in '{table_name}'.")
        con_source.close()
        con_target.close()
        return

    # Delete existing data in target table just in case
    cur_target.execute(f'DELETE FROM "{table_name}"')
    
    # Insert data
    insert_query = f'INSERT INTO "{table_name}" ({cols_str}) VALUES ({placeholders})'
    
    try:
        cur_target.executemany(insert_query, rows)
        con_target.commit()
        print(f"Successfully migrated {len(rows)} rows for '{table_name}'.")
    except Exception as e:
        print(f"Error migrating '{table_name}': {e}")
        con_target.rollback()

    con_source.close()
    con_target.close()

if __name__ == "__main__":
    if not os.path.exists(target_db):
        print(f"Target DB {target_db} does not exist. Please run Prisma db push first.")
    else:
        migrate_table(source_stock_db, target_db, "stockvalorizado")
        migrate_table(source_ventas_db, target_db, "ventas")
        print("Migration complete!")
