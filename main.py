import requests
import json

if __name__ == '__main__':
    response = requests.get("https://api.weather.gov/gridpoints/PHI/49,75/forecast")
    print(response)
    periods = json.loads(response.text)['properties']['periods']

    for period in periods:
        temperature = period['temperature']
        note = temperature % 12
        print(note)
