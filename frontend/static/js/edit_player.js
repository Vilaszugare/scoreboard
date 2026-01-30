// edit_player.js
import { API_URL } from './config.js'; // Decoupled from api.js

let isEditPlayerHtmlLoaded = false;

// Dynamic CSS Loader
function loadEditPlayerCSS() {
    if (!document.getElementById('editPlayerCSS')) {
        const link = document.createElement('link');
        link.id = 'editPlayerCSS';
        link.rel = 'stylesheet';
        link.href = '../static/css/edit_player.css';
        document.head.appendChild(link);
    }
}

export async function openEditPlayerModal(player) {
    console.log("Opening Edit Modal for:", player);
    loadEditPlayerCSS();

    if (!isEditPlayerHtmlLoaded || !document.getElementById('editPlayerModal')) {
        try {
            const resp = await fetch('/edit_player_modal.html');
            if (resp.ok) {
                const html = await resp.text();
                // Remove existing if any (cleanup)
                const existing = document.getElementById('editPlayerModal');
                if (existing) existing.remove();

                document.body.insertAdjacentHTML('beforeend', html);
                isEditPlayerHtmlLoaded = true;

                // Attach Event Listeners
                setTimeout(attachEditPlayerEvents, 100);

                // SHOW MODAL NOW
                populateEditModal(player);
                const modal = document.getElementById('editPlayerModal');
                if (modal) modal.showModal();
            } else {
                console.error("Failed to load edit player HTML");
                alert("Failed to load modal template. Check console.");
                return;
            }
        } catch (e) {
            console.error(e);
            alert("Error loading modal: " + e.message);
            return;
        }
    } else {
        // Just populate if already loaded
        populateEditModal(player);
        const modal = document.getElementById('editPlayerModal');
        if (modal) modal.showModal();
    }
}

function attachEditPlayerEvents() {
    const btnUpdate = document.getElementById('btnUpdatePlayerInfo');
    const btnDelete = document.getElementById('btnDeletePlayer');
    const btnUpload = document.getElementById('btnUploadPhoto');
    const trashPhoto = document.querySelector('.ep-trash-icon');

    if (btnUpdate) btnUpdate.onclick = handleUpdateClick;
    if (btnDelete) btnDelete.onclick = handleDeleteClick;

    // --- File Upload Logic ---
    if (btnUpload) {
        // Create hidden file input if not exists
        let hiddenInput = document.getElementById('hidden-player-photo-input');
        if (!hiddenInput) {
            hiddenInput = document.createElement('input');
            hiddenInput.type = 'file';
            hiddenInput.id = 'hidden-player-photo-input';
            hiddenInput.accept = 'image/*';
            hiddenInput.style.display = 'none';
            document.body.appendChild(hiddenInput);

            hiddenInput.onchange = handlePhotoSelected;
        }

        btnUpload.onclick = () => {
            hiddenInput.click();
        };
    }

    if (trashPhoto) {
        trashPhoto.onclick = () => {
            document.getElementById('edit_player_photo_url').value = "";
            const img = document.getElementById('edit_player_photo_img');
            img.src = "";
            img.style.display = 'none';
        };
    }
}

async function handlePhotoSelected(event) {
    const file = event.target.files[0];
    if (!file) return;

    const playerId = document.getElementById('edit_player_id').value;
    if (!playerId) return alert("Error: No Player ID found");

    const formData = new FormData();
    formData.append("file", file);

    const btn = document.getElementById('btnUploadPhoto');
    const oldText = btn.innerText;
    btn.innerText = "Uploading...";
    btn.disabled = true;

    try {
        const res = await fetch(`${API_URL}/players/${playerId}/upload_photo`, {
            method: 'POST',
            body: formData
        });

        const data = await res.json();
        if (data.status === 'success') {
            // Update UI
            document.getElementById('edit_player_photo_url').value = data.photo_url;
            const img = document.getElementById('edit_player_photo_img');
            img.src = data.photo_url;
            img.style.display = 'block';
            alert("Photo Uploaded!");
        } else {
            alert("Upload Failed: " + (data.message || "Unknown Error"));
        }
    } catch (e) {
        console.error(e);
        alert("Upload Network Error");
    } finally {
        btn.innerText = oldText;
        btn.disabled = false;
        event.target.value = ""; // Reset input
    }
}

function populateEditModal(player) {
    document.getElementById('edit_player_id').value = player.id;
    document.getElementById('edit_player_name').value = player.name;
    document.getElementById('ep-player-name-title').textContent = player.name; // Header Title
    document.getElementById('edit_player_role').value = player.role || 'Batsman';

    const photoUrl = player.photo_url || '';
    document.getElementById('edit_player_photo_url').value = photoUrl;
    const img = document.getElementById('edit_player_photo_img');
    if (photoUrl) {
        img.src = photoUrl;
        img.style.display = 'block';
    } else {
        img.style.display = 'none';
    }

    const modal = document.getElementById('editPlayerModal');
    if (modal) modal.showModal();
}

// Exposed to Window for HTML attributes
window.submitEditPlayer = submitEditPlayer;

async function handleUpdateClick() {
    await submitEditPlayer(false);
}

/**
 * Robust Save Function
 * @param {boolean} silent - If true, suppresses alerts and uses subtle indicators.
 */
async function submitEditPlayer(silent = false) {
    const id = document.getElementById('edit_player_id').value;
    const name = document.getElementById('edit_player_name').value;
    const role = document.getElementById('edit_player_role').value;
    const photo_url = document.getElementById('edit_player_photo_url').value;

    if (!id || !name) {
        if (!silent) alert("Name is required");
        return;
    }

    const payload = { name, role, photo_url };

    // UI Indicator for Silent Mode
    const inputs = [document.getElementById('edit_player_name'), document.getElementById('edit_player_role')];
    if (silent) {
        inputs.forEach(el => el.style.borderColor = "#ffd700"); // Yellow = Saving
    } else {
        const btn = document.getElementById('btnUpdatePlayerInfo');
        if (btn) btn.innerText = "Saving...";
    }

    try {
        const res = await fetch(`${API_URL}/players/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            console.log("Auto-save success for player:", id);

            if (!silent) {
                alert("Player updated successfully!");
                document.getElementById('editPlayerModal').close();
            } else {
                // Green Flash for success
                inputs.forEach(el => {
                    el.style.borderColor = "#00e676";
                    setTimeout(() => el.style.borderColor = "", 1000);
                });
            }

            // Refresh logic
            if (window.loadSquadPlayers) window.loadSquadPlayers();
            if (window.refreshQuickSquads) window.refreshQuickSquads();

            // Also update header title if name changed
            const title = document.getElementById('ep-player-name-title');
            if (title) title.textContent = name;

        } else {
            const err = await res.text();
            console.error("Auto-save failed:", err);
            if (!silent) alert("Error updating: " + err);
            if (silent) inputs.forEach(el => el.style.borderColor = "red");
        }
    } catch (err) {
        console.error(err);
        if (!silent) alert("Failed to update player (Network Error)");
        if (silent) inputs.forEach(el => el.style.borderColor = "red");
    } finally {
        if (!silent) {
            const btn = document.getElementById('btnUpdatePlayerInfo');
            if (btn) btn.innerText = "Update";
        }
    }
}

function handleDeleteClick() {
    if (confirm("Are you sure you want to delete this player?")) {
        alert("Delete functionality to be implemented in backend.");
    }
}
