// Add anchor links to all headings
function addAnchor(element) {
    element.insertAdjacentHTML('beforeend', `<a href="#${element.id}" class="hanchor" ariaLabel="Anchor">   #</a>` )
}
document.addEventListener('DOMContentLoaded', function () {
    var headers = document.querySelectorAll('article h1[id], article h2[id], article h3[id], article h4[id]')
    if (headers) {
        headers.forEach(addAnchor)
    }

    // https://stackoverflow.com/questions/7717527/smooth-scrolling-when-clicking-an-anchor-link
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();

            document.querySelector(this.getAttribute('href')).scrollIntoView({
                behavior: 'smooth'
            });
        });
    });

 });



// Update side-nav with current heading
window.addEventListener('DOMContentLoaded', () => {
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            const id = entry.target.getAttribute('id');
            if (entry.intersectionRatio > 0) {
                clearActiveStatesInTableOfContents();
                document.querySelector(`.nav li a[href="#${id}"]`).parentElement.classList.add('active');
            } else {
                document.querySelector(`.nav li a[href="#${id}"]`).parentElement.classList.remove('active');
            }
        });
    });

    document.querySelectorAll('article h1[id]').forEach((section) => {
        observer.observe(section);
    });
});

function clearActiveStatesInTableOfContents() {
    document.querySelectorAll('aside nav li').forEach((section) => {
        section.classList.remove('active');
    });
}
