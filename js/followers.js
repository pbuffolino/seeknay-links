function formatCount(count) {
    if (!count) return '';
    if (count >= 1000000) {
        return (count / 1000000).toFixed(1) + 'M followers';
    } else if (count >= 1000) {
        return (count / 1000).toFixed(1) + 'k followers';
    }
    return count + ' followers';
}

async function fetchBluesky(el) {
    try {
        const res = await fetch('https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=seeknay.com');
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        el.textContent = formatCount(data.followersCount);
    } catch (e) {
        console.warn('Bluesky fetch failed', e);
    }
}

async function updateFollowers() {
    const elements = document.querySelectorAll('.link-followers');

    elements.forEach(el => {
        const network = el.dataset.network;
        if (network === 'bluesky') {
            fetchBluesky(el);
        }

        // Example for YouTube (requires API Key):
        // if (network === 'youtube') {
        //     const channelId = 'YourChannelID';
        //     const apiKey = 'YourAPIKey';
        //     fetch(`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelId}&key=${apiKey}`)
        //         .then(res => res.json())
        //         .then(data => {
        //             const count = data.items[0].statistics.subscriberCount;
        //             el.textContent = formatCount(count);
        //         })
        //         .catch(console.error);
        // }
    });
}

document.addEventListener('DOMContentLoaded', updateFollowers);
