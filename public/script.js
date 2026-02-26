document.addEventListener('DOMContentLoaded', () => {
    
    // ==========================================
    // 1. CONFIGURATION & VARIABLES
    // ==========================================
    const API_URL = 'https://quantcv2.onrender.com/api'; // Live Render API
    const MAX_FILES = 10;
    
    // Upload State
    let sessionFiles = []; 
    let selectedIndices = new Set();
    
    // Retrieve & Edit State
    let retrievedFiles = [];
    let currentSessionCode = '';
    let currentSessionPassword = '';
    let editSelectedIndices = new Set();
    let isEditMode = false;

    // ==========================================
    // 2. DOM ELEMENTS
    // ==========================================
    const views = {
        single: document.getElementById('view-single'),
        session: document.getElementById('view-session'),
        retrieve: document.getElementById('view-retrieve'),
        results: document.getElementById('view-results'),
        success: document.getElementById('view-success')
    };

    const navs = {
        single: document.getElementById('nav-single'),
        session: document.getElementById('nav-session'),
        retrieve: document.getElementById('nav-retrieve')
    };

    // Single Upload Elements
    const singleFileInput = document.getElementById('single-file-input');
    const singleFileName = document.getElementById('single-file-name');
    const singleForm = document.getElementById('form-single');

    // Session Elements
    const sessionListEl = document.getElementById('session-file-list');
    const sessionInput = document.getElementById('session-file-input');
    const toolbar = document.getElementById('session-toolbar');
    const selectAllCheckbox = document.getElementById('select-all-files');
    const batchDeleteBtn = document.getElementById('batch-delete-btn');
    const emptyDropZone = document.getElementById('empty-drop-zone');
    const fileCountSpan = document.getElementById('file-count');
    const sessionSubmitBtn = document.getElementById('session-submit-btn');

    // ==========================================
    // 3. NAVIGATION & UI UTILS
    // ==========================================
    function switchView(viewName) {
        Object.values(navs).forEach(btn => btn.classList.remove('active'));
        if(navs[viewName]) navs[viewName].classList.add('active');

        Object.values(views).forEach(el => {
            if (!el.classList.contains('hidden')) {
                gsap.to(el, { opacity: 0, y: 20, duration: 0.3, onComplete: () => el.classList.add('hidden') });
            }
        });
        
        const target = views[viewName];
        target.classList.remove('hidden');
        gsap.fromTo(target, { opacity: 0, y: -20 }, { opacity: 1, y: 0, duration: 0.5, delay: 0.3, ease: "power2.out" });
    }

    navs.single.addEventListener('click', () => switchView('single'));
    navs.session.addEventListener('click', () => switchView('session'));
    navs.retrieve.addEventListener('click', () => switchView('retrieve'));

    function showToast(msg, type) {
        const container = document.getElementById('toast-container');
        if(!container) return alert(msg);
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.style.borderLeftColor = type === 'error' ? '#ef4444' : '#4ade80';
        toast.innerHTML = `<i class="fa-solid ${type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check'}"></i> ${msg}`;
        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 500); }, 4000);
    }

    // ==========================================
    // 4. CLOUDINARY UPLOAD HELPER
    // ==========================================
    async function uploadToCloudinary(file, onProgress) {
        try {
            const signRes = await fetch(`${API_URL}/sign-upload`);
            if(!signRes.ok) throw new Error("Could not get secure signature.");
            const signData = await signRes.json();

            const formData = new FormData();
            formData.append("file", file);
            formData.append("api_key", signData.apiKey);
            formData.append("timestamp", signData.timestamp);
            formData.append("signature", signData.signature);
            formData.append("folder", "quantc_v2_neural");

            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open("POST", `https://api.cloudinary.com/v1_1/${signData.cloudName}/auto/upload`, true);
                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
                };
                xhr.onload = () => {
                    if (xhr.status === 200) resolve(JSON.parse(xhr.responseText));
                    else reject("Cloud Upload Error");
                };
                xhr.onerror = () => reject("Network Error during upload");
                xhr.send(formData);
            });
        } catch (error) { throw error.message || error; }
    }

    // ==========================================
    // 5. SINGLE UPLOAD LOGIC
    // ==========================================
    singleFileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            singleFileName.innerText = e.target.files[0].name;
            singleFileName.style.color = '#ffffff';
        } else {
            singleFileName.innerText = 'Upload Packet';
            singleFileName.style.color = 'var(--text-muted)';
        }
    });

    singleForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const file = singleFileInput.files[0];
        const password = document.getElementById('single-password').value;
        if(!file || !password) return showToast("File & Key Phrase required", "error");

        const loader = document.getElementById('loader-single');
        loader.classList.remove('hidden');

        try {
            const cloudRes = await uploadToCloudinary(file);
            const saveRes = await fetch(`${API_URL}/save-session`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    password, type: 'single',
                    files: [{ originalName: file.name, url: cloudRes.secure_url, publicId: cloudRes.public_id, format: cloudRes.format, size: cloudRes.bytes }]
                })
            });
            const data = await saveRes.json();
            if(data.success) {
                document.getElementById('generated-code').innerText = data.code;
                switchView('success');
                singleForm.reset();
                singleFileName.innerText = 'Upload Packet';
            } else throw new Error(data.message);
        } catch(e) { showToast(typeof e === 'string' ? e : "Upload Failed", "error"); } 
        finally { loader.classList.add('hidden'); }
    });

    // ==========================================
    // 6. SESSION UPLOAD LOGIC
    // ==========================================
    document.getElementById('add-more-btn').addEventListener('click', () => sessionInput.click());
    emptyDropZone.addEventListener('click', () => sessionInput.click());
    sessionInput.addEventListener('change', () => { handleFiles(Array.from(sessionInput.files)); sessionInput.value = ''; });

    sessionListEl.addEventListener('dragover', (e) => { e.preventDefault(); sessionListEl.classList.add('drag-over'); });
    sessionListEl.addEventListener('dragleave', () => sessionListEl.classList.remove('drag-over'));
    sessionListEl.addEventListener('drop', (e) => {
        e.preventDefault(); sessionListEl.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) handleFiles(Array.from(e.dataTransfer.files));
    });

    function handleFiles(newFiles) {
        const slotsLeft = MAX_FILES - sessionFiles.length;
        if (slotsLeft === 0) return showToast("Session full! Max 10 files.", "error");
        if (newFiles.length > slotsLeft) return showToast(`Only ${slotsLeft} slots left.`, "error");
        newFiles.forEach(file => sessionFiles.push(file));
        renderSessionList();
    }

    function renderSessionList() {
        const existingItems = sessionListEl.querySelectorAll('.stream-item');
        existingItems.forEach(el => el.remove());
        fileCountSpan.innerText = sessionFiles.length;

        if (sessionFiles.length === 0) {
            emptyDropZone.classList.remove('hidden');
            toolbar.classList.add('hidden');
            return;
        }

        emptyDropZone.classList.add('hidden');
        toolbar.classList.remove('hidden');

        sessionFiles.forEach((file, index) => {
            const item = document.createElement('div');
            item.className = `stream-item ${selectedIndices.has(index) ? 'selected' : ''}`;
            item.innerHTML = `
                <label class="custom-checkbox"><input type="checkbox" class="file-checkbox" data-index="${index}" ${selectedIndices.has(index) ? 'checked' : ''}><span class="checkmark"></span></label>
                <div class="file-name" title="${file.name}">${file.name}</div>
                <button type="button" class="btn-item-remove" onclick="removeSingleFile(${index})"><i class="fa-solid fa-xmark"></i></button>
            `;
            sessionListEl.appendChild(item);
        });

        document.querySelectorAll('.file-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.index);
                if (e.target.checked) selectedIndices.add(idx); else selectedIndices.delete(idx);
                renderSessionList();
            });
        });
        updateToolbar();
    }

    function updateToolbar() {
        const count = selectedIndices.size;
        batchDeleteBtn.classList.toggle('hidden', count === 0);
        selectAllCheckbox.checked = (count === sessionFiles.length && count > 0);
    }

    window.removeSingleFile = (index) => { sessionFiles.splice(index, 1); selectedIndices.clear(); renderSessionList(); };
    selectAllCheckbox.addEventListener('change', (e) => {
        if (e.target.checked) sessionFiles.forEach((_, i) => selectedIndices.add(i)); else selectedIndices.clear();
        renderSessionList();
    });
    batchDeleteBtn.addEventListener('click', () => {
        sessionFiles = sessionFiles.filter((_, index) => !selectedIndices.has(index));
        selectedIndices.clear(); renderSessionList();
    });

    // --- Trigger Submit on Enter Key ---
    document.getElementById('session-password').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            sessionSubmitBtn.click();
        }
    });

    sessionSubmitBtn.addEventListener('click', async () => {
        const password = document.getElementById('session-password').value;
        if(sessionFiles.length === 0) return showToast('Basket is empty', 'error');
        if(!password) return showToast('Session Key required', 'error');

        const loader = document.getElementById('loader-session');
        const progressText = document.getElementById('progress-text-session');
        loader.classList.remove('hidden');

        try {
            const uploadedMeta = [];
            for (let i = 0; i < sessionFiles.length; i++) {
                progressText.innerText = `Uploading ${i + 1}/${sessionFiles.length}: ${sessionFiles[i].name}`;
                const cloudRes = await uploadToCloudinary(sessionFiles[i], (pct) => progressText.innerText = `Uploading ${i+1}/${sessionFiles.length} (${pct}%)`);
                uploadedMeta.push({ originalName: sessionFiles[i].name, url: cloudRes.secure_url, publicId: cloudRes.public_id, format: cloudRes.format, size: cloudRes.bytes });
            }

            progressText.innerText = "Securing Data...";
            const saveRes = await fetch(`${API_URL}/save-session`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password, type: 'session', files: uploadedMeta })
            });
            const saveData = await saveRes.json();
            
            if(saveData.success) {
                document.getElementById('generated-code').innerText = saveData.code;
                sessionFiles.length = 0; document.getElementById('session-password').value = ''; renderSessionList();
                switchView('success'); showToast('Upload Successful!', 'success');
            } else throw new Error(saveData.message);
        } catch (err) { showToast(typeof err === 'string' ? err : 'Upload Failed', 'error'); } 
        finally { loader.classList.add('hidden'); }
    });


    // ==========================================
    // 7. RETRIEVE & RESULTS (DUAL MODE) LOGIC
    // ==========================================
    document.getElementById('form-retrieve').addEventListener('submit', async (e) => {
        e.preventDefault();
        currentSessionCode = document.getElementById('retrieve-code').value;
        currentSessionPassword = document.getElementById('retrieve-password').value;
        const loader = document.getElementById('loader-retrieve');
        loader.classList.remove('hidden');

        try {
            const res = await fetch(`${API_URL}/retrieve`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: currentSessionCode, password: currentSessionPassword })
            });
            const data = await res.json();
            
            if(data.success) {
                document.getElementById('retrieve-code').value = ''; document.getElementById('retrieve-password').value = '';
                
                if (data.files.length === 1 && data.files[0].format !== 'session') {
                    triggerDownload(data.files[0].url, data.files[0].originalName);
                    showToast("Packet Decrypted & Downloading!", "success");
                    switchView('single'); return;
                }

                retrievedFiles = data.files;
                editSelectedIndices.clear();
                isEditMode = false; // Always start in Retrieval Mode
                document.getElementById('session-code-display').innerText = currentSessionCode;
                renderResultsList();
                switchView('results');
            } else showToast(data.message || "Invalid Credentials", "error");
        } catch(e) { showToast("Network Error", "error"); } 
        finally { loader.classList.add('hidden'); }
    });

    function renderResultsList() {
        const listEl = document.getElementById('results-file-list');
        listEl.innerHTML = "";
        document.getElementById('result-count').innerText = retrievedFiles.length;

        const isEmpty = retrievedFiles.length === 0;

        // UI Toggles depending on mode
        document.getElementById('normal-toolbar').classList.toggle('hidden', isEditMode);
        document.getElementById('normal-footer').classList.toggle('hidden', isEditMode);
        document.getElementById('edit-footer').classList.toggle('hidden', !isEditMode);
        
        const editToolbar = document.getElementById('edit-toolbar');
        const editDropZone = document.getElementById('edit-drop-zone');

        // Mirroing Upload Session Logic for Dropzone & Toolbar
        if (isEditMode) {
            if (isEmpty) {
                editToolbar.classList.add('hidden');
                editDropZone.classList.remove('hidden');
            } else {
                editToolbar.classList.remove('hidden');
                editDropZone.classList.add('hidden');
            }
        } else {
            editToolbar.classList.add('hidden');
            editDropZone.classList.add('hidden');
        }

        // Render File Streams
        retrievedFiles.forEach((f, index) => {
            const item = document.createElement('div');
            item.className = 'stream-item';
            
            if (isEditMode) {
                // EDIT MODE RENDERING
                const isSelected = editSelectedIndices.has(index);
                if(isSelected) item.classList.add('selected');
                
                item.innerHTML = `
                    <label class="custom-checkbox">
                        <input type="checkbox" class="edit-file-checkbox" data-index="${index}" ${isSelected ? 'checked' : ''}>
                        <span class="checkmark"></span>
                    </label>
                    <div class="file-name" title="${f.originalName}">${f.originalName}</div>
                    <button type="button" class="btn-item-remove" onclick="removeRetrievedFile(${index})"><i class="fa-solid fa-xmark"></i></button>
                `;
            } else {
                // NORMAL RETRIEVAL RENDERING
                item.innerHTML = `
                    <div class="file-name" title="${f.originalName}" style="margin-left: 0;">${f.originalName}</div>
                    <button type="button" class="btn-item-download" data-url="${f.url}" data-name="${f.originalName}"><i class="fa-solid fa-download"></i></button>
                `;
            }
            listEl.appendChild(item);
        });

        // Attach Event Listeners
        if (isEditMode) {
            document.querySelectorAll('.edit-file-checkbox').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const idx = parseInt(e.target.dataset.index);
                    if (e.target.checked) editSelectedIndices.add(idx); else editSelectedIndices.delete(idx);
                    renderResultsList();
                });
            });

            const count = editSelectedIndices.size;
            const batchDeleteBtn = document.getElementById('edit-batch-delete-btn');
            if(batchDeleteBtn) batchDeleteBtn.classList.toggle('hidden', count === 0);
            
            const selectAllCb = document.getElementById('edit-select-all');
            if(selectAllCb) selectAllCb.checked = (count === retrievedFiles.length && count > 0);
        } else {
            document.querySelectorAll('.btn-item-download').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    triggerDownload(e.currentTarget.dataset.url, e.currentTarget.dataset.name);
                    showToast(`Downloading: ${e.currentTarget.dataset.name}`, 'success');
                });
            });
        }
    }

    // Force Download Helper
    window.triggerDownload = (url, filename) => {
        const downloadUrl = url.replace('/upload/', '/upload/fl_attachment/');
        const link = document.createElement('a');
        link.href = downloadUrl; link.download = filename;
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
    };

    window.removeRetrievedFile = (index) => { 
        retrievedFiles.splice(index, 1); 
        editSelectedIndices.clear(); 
        renderResultsList(); 
    };

    // --- NORMAL MODE ACTIONS ---
    document.getElementById('download-all-btn').addEventListener('click', () => {
        showToast("Initiating bulk download...", "success");
        retrievedFiles.forEach((file, index) => setTimeout(() => triggerDownload(file.url, file.originalName), index * 800));
    });

    document.getElementById('edit-session-btn').addEventListener('click', () => {
        isEditMode = true;
        editSelectedIndices.clear();
        renderResultsList();
    });

    // --- EDIT MODE ACTIONS ---
    document.getElementById('edit-select-all').addEventListener('change', (e) => {
        if (e.target.checked) retrievedFiles.forEach((_, i) => editSelectedIndices.add(i)); 
        else editSelectedIndices.clear();
        renderResultsList();
    });

    document.getElementById('edit-batch-delete-btn').addEventListener('click', () => {
        retrievedFiles = retrievedFiles.filter((_, index) => !editSelectedIndices.has(index));
        editSelectedIndices.clear(); 
        renderResultsList();
    });

    // --- Add More Files (Edit Mode) ---
    const editFileInput = document.getElementById('edit-file-input');
    document.getElementById('edit-add-more-btn').addEventListener('click', () => editFileInput.click());
    document.getElementById('edit-drop-zone').addEventListener('click', () => editFileInput.click());
    
    editFileInput.addEventListener('change', async (e) => {
        const newFiles = Array.from(e.target.files);
        if (retrievedFiles.length + newFiles.length > MAX_FILES) return showToast("Limit Exceeded. Max 10 files.", "error");

        const loader = document.getElementById('loader-edit');
        const progressText = document.getElementById('progress-text-edit');
        loader.classList.remove('hidden');

        try {
            for (let i = 0; i < newFiles.length; i++) {
                progressText.innerText = `Uploading New File ${i+1}/${newFiles.length}...`;
                const cloudRes = await uploadToCloudinary(newFiles[i]);
                retrievedFiles.push({ originalName: newFiles[i].name, url: cloudRes.secure_url, publicId: cloudRes.public_id, format: cloudRes.format, size: cloudRes.bytes });
            }
            renderResultsList(); showToast("Files added! Click 'SAVE CHANGES'.", "success");
        } catch(err) { showToast("Failed to upload new files", "error"); } 
        finally { loader.classList.add('hidden'); editFileInput.value = ''; }
    });

    // --- Save Edits ---
    document.getElementById('save-edits-btn').addEventListener('click', async () => {
        if(retrievedFiles.length === 0) return showToast("Cannot save empty session. Delete it instead.", "error");
        
        const loader = document.getElementById('loader-edit');
        document.getElementById('progress-text-edit').innerText = "Securing Changes...";
        loader.classList.remove('hidden');

        try {
            const res = await fetch(`${API_URL}/update-session`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: currentSessionCode, password: currentSessionPassword, files: retrievedFiles })
            });
            const data = await res.json();
            if(data.success) {
                showToast("Session Updated Successfully!", "success");
                isEditMode = false; 
                editSelectedIndices.clear(); 
                renderResultsList(); // Auto-returns to normal mode!
            } else throw new Error(data.message);
        } catch(err) { showToast(typeof err === 'string' ? err : "Failed to update session", "error"); } 
        finally { loader.classList.add('hidden'); }
    });

    // --- Normal Footer Action (Close) ---
    document.getElementById('back-to-home').addEventListener('click', () => {
        switchView('retrieve');
        retrievedFiles = []; currentSessionCode = ''; currentSessionPassword = ''; editSelectedIndices.clear(); isEditMode = false;
    });

    // --- Edit Footer Action (Cancel) ---
    document.getElementById('cancel-edit-btn').addEventListener('click', () => {
        switchView('retrieve');
        retrievedFiles = []; currentSessionCode = ''; currentSessionPassword = ''; editSelectedIndices.clear(); isEditMode = false;
    });

    // ==========================================
    // 8. MISC UTILS & ANIMATIONS
    // ==========================================
    document.getElementById('copy-btn').addEventListener('click', () => {
        navigator.clipboard.writeText(document.getElementById('generated-code').innerText);
        showToast('Code Copied!');
    });
    
    document.getElementById('reset-upload-btn').addEventListener('click', () => UI.switchView('single'));

    document.querySelectorAll('.magnetic-btn').forEach(btn => {
        btn.addEventListener('mousemove', (e) => {
            const rect = btn.getBoundingClientRect();
            gsap.to(btn, { duration: 0.3, x: (e.clientX - rect.left - rect.width/2)*0.3, y: (e.clientY - rect.top - rect.height/2)*0.3 });
        });
        btn.addEventListener('mouseleave', () => gsap.to(btn, { duration: 0.5, x: 0, y: 0, ease: "elastic.out(1, 0.3)" }));
    });
    
    let mouse = { x: 0, y: 0 };
    document.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
    
    function updateBackground() {
        const mx = (window.innerWidth/2 - mouse.x)*0.05, my = (window.innerHeight/2 - mouse.y)*0.05;
        gsap.to('#orb-1', { x: mx, y: my, duration: 2 });
        gsap.to('#orb-2', { x: -mx, y: -my, duration: 2 });
        gsap.to('#orb-3', { x: mx/2, y: my/2, duration: 2 });
        requestAnimationFrame(updateBackground);
    }
    updateBackground();

    // --- WAKE UP SERVER ON PAGE LOAD ---
    fetch(`${API_URL}/ping`).catch(() => console.log("Waking up server..."));
});