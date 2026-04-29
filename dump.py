import sqlite3

def dump(db_path):
    print(f"--- {db_path} ---")
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    cur.execute("SELECT name, sql FROM sqlite_master WHERE type='table';")
    for row in cur.fetchall():
        print(f"Table: {row[0]}")
        print(row[1])
        print("Columns info:")
        cur2 = con.cursor()
        cur2.execute(f"PRAGMA table_info({row[0]})")
        for col in cur2.fetchall():
            print(f"  {col}")
        
        print("First row data:")
        try:
            cur3 = con.cursor()
            cur3.execute(f"SELECT * FROM {row[0]} LIMIT 1")
            for data in cur3.fetchall():
                print(f"  {data}")
        except:
            pass
    con.close()

dump(r"C:\Users\JAMC\Desktop\CAPSTONE\bbdd equipo\stockvalorizado.db")
dump(r"C:\Users\JAMC\Desktop\CAPSTONE\bbdd equipo\ventas.db")
