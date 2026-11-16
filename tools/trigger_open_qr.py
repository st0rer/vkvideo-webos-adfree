from cdp_eval import evaluate

js = """
(async () => {
    await window.vkApp.openQRModal();
    return {
        modal: document.getElementById('qr-modal').style.display,
        code: document.getElementById('qr-auth-code').textContent,
        status: document.getElementById('qr-status').textContent
    };
})()
"""

print(evaluate(js))
