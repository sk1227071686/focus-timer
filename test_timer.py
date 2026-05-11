from playwright.sync_api import sync_playwright
import time

def parse_time(time_str):
    try:
        parts = time_str.strip().split(":")
        return int(parts[0])*60 + int(parts[1])
    except:
        return -1

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto("http://localhost:8080")
    page.wait_for_load_state('networkidle')

    def find_timer_el():
        candidates = page.query_selector_all("*")
        for el in candidates:
            try:
                txt = el.inner_text().strip()
                if ':' in txt and len(txt) <= 6:
                    return el
            except:
                continue
        return None

    timer_el = find_timer_el()
    if not timer_el:
        print('FAIL: timer not found')
    else:
        print('Found timer:', timer_el.inner_text())

    # Step 1: check title
    print('Title:', page.title())

    # Step 2: click start
    try:
        page.get_by_text('开始', exact=True).click()
    except Exception as e:
        print('Click start failed', e)

    t1 = timer_el.inner_text()
    time.sleep(2)
    t2 = timer_el.inner_text()
    print('Before:', t1, 'After:', t2)

    # Pause
    try:
        page.get_by_text('暂停', exact=False).click()
    except Exception as e:
        print('Click pause failed', e)
    tp = timer_el.inner_text()
    time.sleep(2)
    tp2 = timer_el.inner_text()
    print('Pause at', tp, 'after 2s', tp2)

    # Resume
    try:
        page.get_by_text('继续', exact=False).click()
    except Exception as e:
        print('Click resume failed', e)
    tr1 = timer_el.inner_text()
    time.sleep(2)
    tr2 = timer_el.inner_text()
    print('Resume:', tr1, '->', tr2)

    # Reset
    try:
        page.get_by_text('重置', exact=False).click()
    except Exception as e:
        print('Click reset failed', e)
    time.sleep(1)
    print('After reset:', timer_el.inner_text())

    browser.close()
