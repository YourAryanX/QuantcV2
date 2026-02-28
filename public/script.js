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

    const singleFileInput = document.getElementById('single-file-input');
    const singleFileName = document.getElementById('single-file-name');
    const singleForm = document.getElementById('form-single');

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
        if (navs[viewName] && navs[viewName].classList.contains('active')) {
            const target = views[viewName];
            
            gsap.to(target, { opacity: 0, y: 10, duration: 0.2, onComplete: () => {
                if (viewName === 'single') {
                    document.getElementById('form-single').reset();
                    document.getElementById('single-file-name').innerText = 'Upload Packet';
                    document.getElementById('single-file-name').style.color = 'var(--text-muted)';
                } else if (viewName === 'session') {
                    sessionFiles.length = 0;
                    selectedIndices.clear();
                    renderSessionList();
                    document.getElementById('session-password').value = '';
                } else if (viewName === 'retrieve') {
                    document.getElementById('form-retrieve').reset();
                }
                
                gsap.to(target, { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" });
            }});
            return;
        }

        Object.values(navs).forEach(btn => btn.classList.remove('active'));
        if(navs[viewName]) navs[viewName].classList.add('active');

        const currentView = Object.values(views).find(el => !el.classList.contains('hidden'));
        const targetView = views[viewName];

        if (currentView) {
            gsap.to(currentView, { 
                opacity: 0, 
                y: 15, 
                duration: 0.25, 
                onComplete: () => {
                    currentView.classList.add('hidden');
                    targetView.classList.remove('hidden');
                    gsap.fromTo(targetView, 
                        { opacity: 0, y: -15 }, 
                        { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" }
                    );
                } 
            });
        } else {
            targetView.classList.remove('hidden');
            gsap.fromTo(targetView, { opacity: 0, y: -15 }, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" });
        }
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
    // 4. THE SHREDDER (DYNAMIC CHUNKING & ENCRYPTION)
    // ==========================================
    async function shredAndUpload(file, password, onProgress) {
        try {
            let dynamicChunkSize = 5 * 1024 * 1024; 
            if (file.size > 50 * 1024 * 1024) dynamicChunkSize = 25 * 1024 * 1024; 
            if (file.size > 500 * 1024 * 1024) dynamicChunkSize = 50 * 1024 * 1024; 

            const encoder = new TextEncoder();
            const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), {name: "PBKDF2"}, false, ["deriveKey"]);
            const salt = crypto.getRandomValues(new Uint8Array(16));
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const key = await crypto.subtle.deriveKey(
                {name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256"}, 
                keyMaterial, {name: "AES-GCM", length: 256}, false, ["encrypt"]
            );

            const totalChunks = Math.ceil(file.size / dynamicChunkSize) || 1;
            const chunkUrls = [];

            const signRes = await fetch(`${API_URL}/sign-upload`);
            if(!signRes.ok) throw new Error("Could not get secure signature.");
            const signData = await signRes.json();

            for (let i = 0; i < totalChunks; i++) {
                const start = i * dynamicChunkSize;
                const end = Math.min(start + dynamicChunkSize, file.size);
                const slice = file.slice(start, end);
                const buffer = await slice.arrayBuffer();

                const encryptedBuffer = await crypto.subtle.encrypt({name: "AES-GCM", iv: iv}, key, buffer);
                const encryptedBlob = new Blob([encryptedBuffer], {type: "application/octet-stream"});

                const formData = new FormData();
                formData.append("file", encryptedBlob, `chunk_${i}.dat`);
                formData.append("api_key", signData.apiKey);
                formData.append("timestamp", signData.timestamp);
                formData.append("signature", signData.signature);
                formData.append("folder", "quantc_v2_chunks");
                formData.append("resource_type", "raw"); 

                await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open("POST", `https://api.cloudinary.com/v1_1/${signData.cloudName}/raw/upload`, true);
                    
                    xhr.upload.onprogress = (e) => {
                        if (e.lengthComputable && onProgress) {
                            const chunkPercent = (e.loaded / e.total);
                            const overallProgress = Math.round(((i + chunkPercent) / totalChunks) * 100);
                            onProgress(overallProgress);
                        }
                    };
                    
                    xhr.onload = () => {
                        if (xhr.status === 200) {
                            const data = JSON.parse(xhr.responseText);
                            chunkUrls.push(data.secure_url);
                            resolve();
                        } else reject("Chunk Upload Error");
                    };
                    xhr.onerror = () => reject("Network Error during upload");
                    xhr.send(formData);
                });
            }

            return { 
                originalName: file.name, 
                chunks: chunkUrls, 
                salt: Array.from(salt), 
                iv: Array.from(iv), 
                size: file.size, 
                format: 'encrypted' 
            };
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
        const progressText = document.getElementById('progress-text-single');
        loader.classList.remove('hidden');

        try {
            const fileData = await shredAndUpload(file, password, (pct) => {
                if (progressText) progressText.innerText = `Encrypting Packet (${pct}%)`;
            });
            
            const saveRes = await fetch(`${API_URL}/save-session`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password, type: 'single', files: [fileData] })
            });
            const data = await saveRes.json();
            
            if(data.success) {
                document.getElementById('generated-code').innerText = data.code;
                switchView('success');
                singleForm.reset();
                singleFileName.innerText = 'Upload Packet';
            } else throw new Error(data.message);
        } catch(e) { 
            showToast(typeof e === 'string' ? e : "Upload Failed", "error"); 
        } finally { 
            loader.classList.add('hidden'); 
            if (progressText) progressText.innerText = "Injecting Packet..."; 
        }
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
                progressText.innerText = `Encrypting ${i + 1}/${sessionFiles.length}: ${sessionFiles[i].name}`;
                const chunkedFile = await shredAndUpload(sessionFiles[i], password, (pct) => {
                    progressText.innerText = `Encrypting ${i+1}/${sessionFiles.length} (${pct}%)`;
                });
                uploadedMeta.push(chunkedFile);
            }

            progressText.innerText = "Securing Manifest...";
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
        finally { loader.classList.add('hidden'); progressText.innerText = "Processing Session..."; }
    });

    // ==========================================
    // 7. RETRIEVE & RESULTS (THE REASSEMBLER)
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
                    triggerDownload(data.files[0], currentSessionPassword);
                    switchView('single'); return;
                }

                retrievedFiles = data.files;
                editSelectedIndices.clear();
                isEditMode = false;
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

        document.getElementById('normal-toolbar').classList.toggle('hidden', isEditMode);
        document.getElementById('normal-footer').classList.toggle('hidden', isEditMode);
        document.getElementById('edit-footer').classList.toggle('hidden', !isEditMode);
        
        const editToolbar = document.getElementById('edit-toolbar');
        const editDropZone = document.getElementById('edit-drop-zone');

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

        retrievedFiles.forEach((f, index) => {
            const item = document.createElement('div');
            item.className = 'stream-item';
            
            if (isEditMode) {
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
                item.innerHTML = `
                    <div class="file-name" title="${f.originalName}" style="margin-left: 0;">${f.originalName}</div>
                    <button type="button" class="btn-item-download" data-index="${index}"><i class="fa-solid fa-download"></i></button>
                `;
            }
            listEl.appendChild(item);
        });

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
                    const idx = parseInt(e.currentTarget.dataset.index);
                    triggerDownload(retrievedFiles[idx], currentSessionPassword);
                });
            });
        }
    }

    window.triggerDownload = async (fileMeta, password) => {
        if (fileMeta.url && !fileMeta.chunks) {
            const downloadUrl = fileMeta.url.replace('/upload/', '/upload/fl_attachment/');
            const link = document.createElement('a');
            link.href = downloadUrl; link.download = fileMeta.originalName;
            document.body.appendChild(link); link.click(); document.body.removeChild(link);
            showToast(`Downloading: ${fileMeta.originalName}`, "success");
            return;
        }

        try {
            showToast(`Starting secure decryption for ${fileMeta.originalName}...`, "success");
            const loader = document.getElementById('loader-edit') || document.getElementById('loader-retrieve');
            const progressText = document.getElementById('progress-text-edit') || document.getElementById('progress-text-retrieve') || { innerText: '' };
            
            if(loader) loader.classList.remove('hidden');

            const encoder = new TextEncoder();
            const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), {name: "PBKDF2"}, false, ["deriveKey"]);
            const salt = new Uint8Array(fileMeta.salt);
            const iv = new Uint8Array(fileMeta.iv);
            const key = await crypto.subtle.deriveKey(
                {name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256"}, 
                keyMaterial, {name: "AES-GCM", length: 256}, false, ["decrypt"]
            );

            let decryptedChunks = [];

            for (let i = 0; i < fileMeta.chunks.length; i++) {
                progressText.innerText = `Decrypting Chunk ${i+1}/${fileMeta.chunks.length}...`;
                
                const res = await fetch(fileMeta.chunks[i]);
                const encryptedBuffer = await res.arrayBuffer();
                const decryptedBuffer = await crypto.subtle.decrypt({name: "AES-GCM", iv: iv}, key, encryptedBuffer);

                decryptedChunks.push(decryptedBuffer);
            }

            progressText.innerText = "Assembling File...";

            const finalBlob = new Blob(decryptedChunks);
            const link = document.createElement('a');
            link.href = URL.createObjectURL(finalBlob);
            link.download = fileMeta.originalName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            setTimeout(() => URL.revokeObjectURL(link.href), 10000);

            showToast("File Decrypted & Downloaded!", "success");
            if(loader) loader.classList.add('hidden');

        } catch (e) {
            console.error(e);
            const loader = document.getElementById('loader-edit') || document.getElementById('loader-retrieve');
            if(loader) loader.classList.add('hidden');
            showToast("Decryption failed. Broken chunk or bad key.", "error");
        }
    };

    window.removeRetrievedFile = (index) => { 
        retrievedFiles.splice(index, 1); 
        editSelectedIndices.clear(); 
        renderResultsList(); 
    };

    document.getElementById('download-all-btn').addEventListener('click', async () => {
        showToast("Initiating bulk download...", "success");
        for(let i=0; i<retrievedFiles.length; i++) {
            await triggerDownload(retrievedFiles[i], currentSessionPassword);
        }
    });

    document.getElementById('edit-session-btn').addEventListener('click', () => {
        isEditMode = true;
        editSelectedIndices.clear();
        renderResultsList();
    });

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
                progressText.innerText = `Encrypting New File ${i+1}/${newFiles.length}...`;
                const chunkedFile = await shredAndUpload(newFiles[i], currentSessionPassword, (pct) => progressText.innerText = `Uploading New File ${i+1}/${newFiles.length} (${pct}%)`);
                retrievedFiles.push(chunkedFile);
            }
            renderResultsList(); showToast("Files added! Click 'SAVE CHANGES'.", "success");
        } catch(err) { showToast("Failed to upload new files", "error"); } 
        finally { loader.classList.add('hidden'); editFileInput.value = ''; }
    });

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
                renderResultsList(); 
            } else throw new Error(data.message);
        } catch(err) { showToast(typeof err === 'string' ? err : "Failed to update session", "error"); } 
        finally { loader.classList.add('hidden'); }
    });

    document.getElementById('back-to-home').addEventListener('click', () => {
        switchView('retrieve');
        retrievedFiles = []; currentSessionCode = ''; currentSessionPassword = ''; editSelectedIndices.clear(); isEditMode = false;
    });

    document.getElementById('cancel-edit-btn').addEventListener('click', () => {
        switchView('retrieve');
        retrievedFiles = []; currentSessionCode = ''; currentSessionPassword = ''; editSelectedIndices.clear(); isEditMode = false;
    });

    // ==========================================
    // 8. MISC UTILS & ANIMATIONS (OPTIMIZED)
    // ==========================================
    document.getElementById('copy-btn').addEventListener('click', () => {
        navigator.clipboard.writeText(document.getElementById('generated-code').innerText);
        showToast('Code Copied!');
    });
    
    document.getElementById('reset-upload-btn').addEventListener('click', () => switchView('single'));

    // --- SENIOR SWE OPTIMIZATION: Hardware Detection ---
    // Detect if the device is a touchscreen (Mobile/Tablet) to disable expensive phantom mouse loops
    const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.matchMedia("(pointer: coarse)").matches);

    // ONLY run expensive mouse-tracking animations if on a laptop/desktop!
    if (!isTouchDevice) {
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
    }

    // --- WAKE UP SERVER ON PAGE LOAD (Fixes Cold Start) ---
    fetch(`${API_URL}/ping`).catch(() => console.log("Waking up server..."));
});