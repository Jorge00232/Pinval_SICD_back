import urllib.request
import json
import time

time.sleep(3) # wait for server

try:
    with urllib.request.urlopen('http://localhost:3000/stock') as response:
        data = json.loads(response.read().decode())
        print(f"Stock data length: {len(data)}")
        if len(data) > 0:
            print(f"First item: {data[0]}")
except Exception as e:
    print(f"Error: {e}")
