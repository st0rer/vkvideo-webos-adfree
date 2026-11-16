from cdp_eval import evaluate
import json
print(json.dumps(evaluate('JSON.parse(localStorage.getItem("vk_user_info") || "{}")'), ensure_ascii=True))
