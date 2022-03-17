import requests

if __name__ == '__main__':
    response = requests.get("https://api.weather.gov/gridpoints/PHI/49,75/forecast").text
    print(response)

