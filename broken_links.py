import requests
import pytest
# from requests.exceptions import MissingSchema, InvalidSchema, InvalidURL
from selenium import webdriver
from webdriver_manager.chrome import ChromeDriverManager
from webdriver_manager.utils import ChromeType
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By

 
# capabilities = {
#     "build" : "[Python] Finding broken links on a webpage using Selenium",
#     "name" : "[Python] Finding broken links on a webpage using Selenium",
#     "platform" : "Windows 10",
#     "browserName" : "Chrome",
#     "version" : "100.0"
# }
 
broken_links = 0
valid_links = 0

# ser = Service() # Optional argument, if not specified will search path
# op = webdriver.ChromeOptions()
# driver = webdriver.Chrome(service=ser, options=op)
op = webdriver.ChromeOptions()
op.add_argument('--headless')
#op.add_argument('--remote-debugging-port=9222')
driver = webdriver.Chrome(service = Service(ChromeDriverManager().install()), options=op) #chrome_type=ChromeType.CHROMIUM
driver.maximize_window()
driver.get('https://andli28.github.io/weblog')
# links = driver.find_elements_by_css_selector("a")
links = driver.find_elements(By.CSS_SELECTOR, "a")


#newDriver = webdriver.Chrome(service = Service(ChromeDriverManager().install()), options=op)
for link in links:
    try:
        request = requests.head(link.get_attribute('href'), data ={'key':'value'}) 
        print("Status of " + link.text + " is " + str(request.status_code)) #+ link.get_attribute('href')
        if (request.status_code == 404):
            broken_links = (broken_links + 1)
        else:
            valid_links = (valid_links + 1)
    except Exception as e:
        print("Exception: " + str(e))
    # except requests.exceptions.MissingSchema:
    #     print("Encountered MissingSchema Exception")
    # except requests.exceptions.InvalidSchema:
    #     print("Encountered InvalidSchema Exception")     
    except:
        print("Encountered Some other exception")
 
print("Detection of broken links completed with " + str(broken_links) + " broken links and " + str(valid_links) + " valid links")