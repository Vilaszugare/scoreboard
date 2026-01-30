import requests
import json

def verify():
    base_url = "http://localhost:8000"
    match_id = 1 # Assuming match ID 1 exists
    
    print(f"Testing commentary for Match {match_id}...")
    try:
        response = requests.get(f"{base_url}/api/match/{match_id}/commentary")
        
        if response.status_code == 200:
            print("✅ Success! Response:")
            data = response.json()
            # Print a snippet
            print(json.dumps(data, indent=2)[:500] + "...")
        else:
            print(f"❌ Failed with status {response.status_code}")
            print(response.text)
            
    except Exception as e:
        print(f"❌ Error: {e}")
        print("Ensure the server is running!")

if __name__ == "__main__":
    verify()
