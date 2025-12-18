"""
Cache Twitter profile avatars locally.
Downloads, resizes to 48x48, and stores in public/avatars.
Fetches avatars for all enabled asset founders.
"""
from typing import Optional, List, Dict
import httpx
import json
import time
from PIL import Image
from io import BytesIO
from config import AVATARS_DIR, X_BEARER_TOKEN, X_API_BASE
from db import get_connection, init_schema, get_enabled_assets

# Avatar size (small for fast canvas rendering)
AVATAR_SIZE = 48


def get_user_profile_image(username: str) -> Optional[str]:
    """Get profile image URL from Twitter API."""
    if not X_BEARER_TOKEN:
        print("No X_BEARER_TOKEN found")
        return None
    
    url = f"{X_API_BASE}/users/by/username/{username}"
    params = {"user.fields": "profile_image_url"}
    headers = {"Authorization": f"Bearer {X_BEARER_TOKEN}"}
    
    with httpx.Client(timeout=30.0) as client:
        response = client.get(url, params=params, headers=headers)
        
        if response.status_code != 200:
            print(f"Error fetching user: {response.status_code}")
            return None
        
        data = response.json()
        user = data.get("data", {})
        
        # Get profile image URL (replace _normal with _400x400 for higher res)
        img_url = user.get("profile_image_url", "")
        if img_url:
            img_url = img_url.replace("_normal", "_400x400")
        
        return img_url


def download_and_resize(url: str, output_path, size: int = AVATAR_SIZE) -> bool:
    """Download image, resize, and save."""
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(url)
            response.raise_for_status()
            
            # Open and resize
            img = Image.open(BytesIO(response.content))
            img = img.convert("RGBA")
            img = img.resize((size, size), Image.Resampling.LANCZOS)
            
            # Save as PNG (supports transparency)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            img.save(output_path, "PNG", optimize=True)
            
            return True
    except Exception as e:
        print(f"Error downloading/resizing image: {e}")
        return False


def get_all_founders() -> List[Dict]:
    """Get all unique founders from enabled assets."""
    conn = get_connection()
    init_schema(conn)
    assets = get_enabled_assets(conn)
    conn.close()

    # Deduplicate founders (in case same founder has multiple assets)
    seen = set()
    founders = []
    for asset in assets:
        founder = asset.get("founder")
        if founder and founder not in seen:
            seen.add(founder)
            founders.append({
                "username": founder,
                "asset_name": asset.get("name"),
                "color": asset.get("color", "#888888"),
            })
    return founders


def main():
    """Cache avatars for all asset founders."""
    print("=" * 60)
    print("Avatar Caching - All Founders")
    print("=" * 60)

    # Ensure avatars directory exists
    AVATARS_DIR.mkdir(parents=True, exist_ok=True)

    founders = get_all_founders()
    print(f"\nFound {len(founders)} unique founders to cache:")
    for f in founders:
        print(f"  - @{f['username']} ({f['asset_name']})")

    success_count = 0
    fail_count = 0

    for founder in founders:
        username = founder["username"]
        output_path = AVATARS_DIR / f"{username}.png"

        # Skip if already cached
        if output_path.exists():
            size_kb = output_path.stat().st_size / 1024
            print(f"\n✓ @{username}: Already cached ({size_kb:.1f} KB)")
            success_count += 1
            continue

        print(f"\n→ @{username}: Fetching profile image...")

        img_url = get_user_profile_image(username)

        if not img_url:
            print(f"  ✗ Could not get profile image URL")
            fail_count += 1
            continue

        print(f"  URL: {img_url}")

        # Download and resize
        if download_and_resize(img_url, output_path):
            size_kb = output_path.stat().st_size / 1024
            print(f"  ✓ Saved: {output_path.name} ({size_kb:.1f} KB)")
            success_count += 1
        else:
            print(f"  ✗ Failed to download/resize")
            fail_count += 1

        # Rate limit: wait between requests
        time.sleep(1.0)

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Cached: {success_count}/{len(founders)}")
    if fail_count > 0:
        print(f"  Failed: {fail_count}")
    print(f"  Output: {AVATARS_DIR}")


if __name__ == "__main__":
    main()



