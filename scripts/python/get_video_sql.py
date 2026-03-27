import psycopg2

# use the same id and password as the postgresql database 
def connect_to_db(dbname, user, password, host):
  """Connects to the PostgreSQL database.

  Args:
      dbname: Name of the database.
      user: Username for database access.
      password: Password for database access.
      host: Hostname or IP address of the database server.

  Returns:
      A psycopg2 connection object or None if connection fails.
  """
  try:
    conn = psycopg2.connect(dbname=dbname, user=user, password=password, host=host)
    return conn
  except Exception as e:
    print(f"Error connecting to database: {e}")
    return None

def get_and_sort_data(conn, table_name, sort_column):
  """Retrieves data from a table and sorts it.

  Args:
      conn: A psycopg2 connection object.
      table_name: Name of the table to retrieve data from.
      sort_column: Name of the column to sort by.

  Returns:
      A list of rows containing the sorted data.
  """
  cursor = conn.cursor()
  try:
    query = f"SELECT * FROM {table_name} ORDER BY {sort_column}"
    cursor.execute(query)
    rows = cursor.fetchall()
    return rows
  except Exception as e:
    print(f"Error retrieving data: {e}")
    return None
  finally:
    cursor.close()  # Always close the cursor

def main():
  # Replace with your actual database credentials
  dbname = "your_database_name"
  user = "your_username"
  password = "your_password"
  host = "your_host"

  # Replace with the table name and sort column
  table_name = "your_table_name"
  sort_column = "your_sort_column"

  conn = connect_to_db(dbname, user, password, host)
  if conn is None:
    return

  data = get_and_sort_data(conn, table_name, sort_column)
  if data is None:
    return

  # Print the sorted data
  print("Sorted Data:")
  for row in data:
    print(row)

if __name__ == "__main__":
  main()