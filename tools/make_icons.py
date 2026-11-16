from PIL import Image, ImageDraw, ImageFont
import os

assets_dir = r"C:\Users\Storer\.gemini\antigravity\scratch\vkvideo-adfree\src\assets"
os.makedirs(assets_dir, exist_ok=True)

def create_icon(size, filename):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Rounded background
    padding = int(size * 0.05)
    radius = int(size * 0.22)
    # Gradient-like background
    draw.rounded_rectangle(
        [padding, padding, size - padding, size - padding],
        radius=radius,
        fill=(0, 119, 255, 255) # VK Blue
    )
    
    # Red play badge (VK Video signature)
    badge_w = int(size * 0.5)
    badge_h = int(size * 0.38)
    bx0 = (size - badge_w) // 2
    by0 = (size - badge_h) // 2
    draw.rounded_rectangle(
        [bx0, by0, bx0 + badge_w, by0 + badge_h],
        radius=int(size * 0.1),
        fill=(255, 43, 66, 255)
    )
    
    # Play triangle (white)
    tx0 = bx0 + int(badge_w * 0.40)
    ty0 = by0 + int(badge_h * 0.25)
    tx1 = bx0 + int(badge_w * 0.68)
    ty1 = by0 + int(badge_h * 0.50)
    tx2 = bx0 + int(badge_w * 0.40)
    ty2 = by0 + int(badge_h * 0.75)
    draw.polygon([(tx0, ty0), (tx1, ty1), (tx2, ty2)], fill=(255, 255, 255, 255))
    
    # 4K badge at bottom right
    badge_4k_w = int(size * 0.36)
    badge_4k_h = int(size * 0.20)
    k4_x0 = size - padding - badge_4k_w
    k4_y0 = size - padding - badge_4k_h
    draw.rounded_rectangle(
        [k4_x0, k4_y0, k4_x0 + badge_4k_w, k4_y0 + badge_4k_h],
        radius=int(size * 0.05),
        fill=(18, 20, 24, 240),
        outline=(255, 215, 0, 255),
        width=max(1, int(size * 0.02))
    )
    
    # Draw simple "4K" text or shapes
    # If default font available:
    try:
        font = ImageFont.load_default()
        draw.text((k4_x0 + int(badge_4k_w * 0.2), k4_y0 + int(badge_4k_h * 0.15)), "4K", fill=(255, 215, 0, 255), font=font)
    except:
        pass

    img.save(os.path.join(assets_dir, filename), "PNG")
    print(f"Created {filename} ({size}x{size})")

create_icon(80, "icon.png")
create_icon(130, "largeIcon.png")
create_icon(192, "extraLargeIcon.png")

# Splash background 1920x1080
splash = Image.new("RGBA", (1920, 1080), (11, 14, 20, 255))
s_draw = ImageDraw.Draw(splash)
# Center logo
center_icon = Image.open(os.path.join(assets_dir, "extraLargeIcon.png")).resize((240, 240))
splash.paste(center_icon, (1920//2 - 120, 1080//2 - 140), center_icon)
splash.save(os.path.join(assets_dir, "splashBackground.png"), "PNG")
print("Created splashBackground.png (1920x1080)")
