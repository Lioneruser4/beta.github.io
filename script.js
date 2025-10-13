const grid = document.getElementById('game-grid');
const scoreDisplay = document.getElementById('score');
const width = 8; // 8x8 ölçüsündə oyun sahəsi
const squareCount = width * width;
const squares = [];
let score = 0;

let emojiBeingDragged;
let emojiBeingReplaced;
let isGameOver = false;

// Bütün mövcud emojilərin daha böyük və müxtəlif setini istifadə edirik!
const emojis = [
    '😀', '😍', '🤩', '🥳', '😎', '😇', '🤫', '💩',
    '🍉', '🍍', '🍓', '🍇', '🍒', '🍋', '🥝', '🍎'
];
// Qeyd: 16 fərqli emoji növü var. Bu, oyunu daha çətin edəcək!

// Azərbaycan Dilində Məlumat
console.log('Emoji Crush oyunu yükləndi. Bütün emojilərlə oynamağa hazır olun!');

// 1. Oyun Taxtasını Yaratmaq
function createBoard() {
    const squareSize = grid.clientWidth / width;
    grid.style.gridTemplateColumns = `repeat(${width}, 1fr)`;
    grid.style.gridTemplateRows = `repeat(${width}, 1fr)`;

    for (let i = 0; i < squareCount; i++) {
        const square = document.createElement('div');
        square.setAttribute('id', i);
        square.classList.add('square');

        // Ölçüləri quraşdırın
        square.style.width = `${squareSize}px`;
        square.style.height = `${squareSize}px`;
        square.style.fontSize = `${squareSize * 0.6}px`;

        // Təsadüfi emoji seçin
        let randomEmoji = Math.floor(Math.random() * emojis.length);
        square.innerHTML = emojis[randomEmoji];

        // Drag & Drop hadisələrini əlavə edin
        addEventListeners(square);

        grid.appendChild(square);
        squares.push(square);
    }
}

// Mobil və Masaüstü üçün Hadisə Dinləyiciləri
function addEventListeners(square) {
    // Masaüstü
    square.addEventListener('dragstart', dragStart);
    square.addEventListener('dragover', dragOver);
    square.addEventListener('dragenter', dragEnter);
    square.addEventListener('dragleave', dragLeave);
    square.addEventListener('drop', dragDrop);
    square.addEventListener('dragend', dragEnd);

    // Mobil Cihazlar (Touch Events)
    square.addEventListener('touchstart', touchStart);
    square.addEventListener('touchmove', touchMove);
    square.addEventListener('touchend', touchEnd);
}

// 2. Drag & Drop Məntiqi (Sürüşdürmə)

// Drag Hadisələri (Masaüstü)
function dragStart(e) {
    emojiBeingDragged = this;
    this.classList.add('drag-start'); // Stil üçün
}

function dragOver(e) {
    e.preventDefault();
}

function dragEnter(e) {
    e.preventDefault();
    this.style.opacity = 0.7; // Üzərinə gələndə fərqləndirmək üçün
}

function dragLeave() {
    this.style.opacity = 1;
}

function dragDrop(e) {
    emojiBeingReplaced = this;
    this.style.opacity = 1;
    e.preventDefault();
}

function dragEnd() {
    this.classList.remove('drag-start');

    if (!emojiBeingReplaced) return;

    const dragId = parseInt(emojiBeingDragged.id);
    const replaceId = parseInt(emojiBeingReplaced.id);

    // Dəyişməyə icazə verilən qonşu indeksləri
    const validMoves = [
        dragId - 1,
        dragId + 1,
        dragId + width,
        dragId - width
    ];

    if (validMoves.includes(replaceId)) {
        // Emojiləri dəyişin
        const draggedEmoji = emojiBeingDragged.innerHTML;
        const replacedEmoji = emojiBeingReplaced.innerHTML;
        emojiBeingReplaced.innerHTML = draggedEmoji;
        emojiBeingDragged.innerHTML = replacedEmoji;

        // Uyğunluqları yoxlayın
        let isMatch = checkRowForThree() || checkColumnForThree();

        // Əgər uyğunluq yoxdursa, dəyişikliyi geri qaytarın
        if (!isMatch) {
            emojiBeingReplaced.innerHTML = replacedEmoji;
            emojiBeingDragged.innerHTML = draggedEmoji;
        }
    }

    emojiBeingDragged = null;
    emojiBeingReplaced = null;
}

// Touch Hadisələri (Mobil)
let startTouchSquare = null;
let endTouchSquare = null;

function touchStart(e) {
    e.preventDefault();
    startTouchSquare = this;
    this.classList.add('drag-start');
}

function touchMove(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const targetElement = document.elementFromPoint(touch.clientX, touch.clientY);
    
    if (targetElement && targetElement.classList.contains('square')) {
        if (endTouchSquare && endTouchSquare !== targetElement) {
            endTouchSquare.style.opacity = 1;
        }
        endTouchSquare = targetElement;
        endTouchSquare.style.opacity = 0.7;
    }
}

function touchEnd(e) {
    if (!startTouchSquare) return;

    startTouchSquare.classList.remove('drag-start');
    
    if (!endTouchSquare) {
        startTouchSquare = null;
        return;
    }

    endTouchSquare.style.opacity = 1;

    emojiBeingDragged = startTouchSquare;
    emojiBeingReplaced = endTouchSquare;

    const dragId = parseInt(emojiBeingDragged.id);
    const replaceId = parseInt(emojiBeingReplaced.id);

    const validMoves = [
        dragId - 1,
        dragId + 1,
        dragId + width,
        dragId - width
    ];

    if (validMoves.includes(replaceId)) {
        const draggedEmoji = emojiBeingDragged.innerHTML;
        const replacedEmoji = emojiBeingReplaced.innerHTML;
        emojiBeingReplaced.innerHTML = draggedEmoji;
        emojiBeingDragged.innerHTML = replacedEmoji;

        let isMatch = checkRowForThree() || checkColumnForThree();

        if (!isMatch) {
            emojiBeingReplaced.innerHTML = replacedEmoji;
            emojiBeingDragged.innerHTML = draggedEmoji;
        }
    }

    startTouchSquare = null;
    endTouchSquare = null;
    emojiBeingDragged = null;
    emojiBeingReplaced = null;
}


// 3. Uyğunluqları Yoxlamaq (Match Checking)

// Xal əlavə etmək funksiyası
function addScore(count) {
    score += count * 10; // Hər patlayan emoji üçün 10 xal
    scoreDisplay.innerHTML = score;
}

// Ard-arda 3 emojini yoxlamaq (Sətirlər üçün)
function checkRowForThree() {
    let matchFound = false;
    for (let i = 0; i < squareCount - 2; i++) {
        const isEndOfRow = [width - 3, width - 2, width - 1].includes(i % width);

        if (isEndOfRow) continue;

        const firstEmoji = squares[i].innerHTML;
        const secondEmoji = squares[i + 1].innerHTML;
        const thirdEmoji = squares[i + 2].innerHTML;

        if (firstEmoji === secondEmoji && secondEmoji === thirdEmoji && !squares[i].classList.contains('is-blank')) {
            // Patlama effekti
            squares[i].classList.add('is-blank');
            squares[i + 1].classList.add('is-blank');
            squares[i + 2].classList.add('is-blank');
            addScore(3);
            matchFound = true;
        }
    }
    return matchFound;
}

// Alt-alta 3 emojini yoxlamaq (Sütunlar üçün)
function checkColumnForThree() {
    let matchFound = false;
    for (let i = 0; i < squareCount - (width * 2); i++) {
        const firstEmoji = squares[i].innerHTML;
        const secondEmoji = squares[i + width].innerHTML;
        const thirdEmoji = squares[i + width * 2].innerHTML;

        if (firstEmoji === secondEmoji && secondEmoji === thirdEmoji && !squares[i].classList.contains('is-blank')) {
            // Patlama effekti
            squares[i].classList.add('is-blank');
            squares[i + width].classList.add('is-blank');
            squares[i + width * 2].classList.add('is-blank');
            addScore(3);
            matchFound = true;
        }
    }
    return matchFound;
}

// 4. Emojiləri Düşürmək və Yeni Emojiləri Yaratmaq

function moveDown() {
    for (let i = 0; i < squareCount - width; i++) {
        if (squares[i + width].classList.contains('is-blank')) {
            squares[i + width].innerHTML = squares[i].innerHTML;
            squares[i + width].classList.remove('is-blank');
            squares[i].innerHTML = '';
            squares[i].classList.add('is-blank');
        }
    }

    // Ən yuxarı sətirdəki boş yerləri yeni emojilərlə doldurun
    for (let i = 0; i < width; i++) {
        if (squares[i].classList.contains('is-blank')) {
            let randomEmoji = Math.floor(Math.random() * emojis.length);
            squares[i].innerHTML = emojis[randomEmoji];
            squares[i].classList.remove('is-blank');
        }
    }
}

// 5. Oyun Dövrü (Game Loop)

function gameLoop() {
    moveDown(); 
    
    let hasNewMatches = checkRowForThree() || checkColumnForThree();

    if (hasNewMatches) {
        setTimeout(gameLoop, 100);
    }
}

createBoard();
setInterval(gameLoop, 100);
