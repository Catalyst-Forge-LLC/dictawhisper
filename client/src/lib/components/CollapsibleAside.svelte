<label for="toggle">❔</label>
<input type="checkbox" id="toggle" />
<aside>
  <h2>DictaWhisper</h2>

  <p>Record or drop an audio file. Browser clips start immediately. Phone-folder watches wait until the file has settled, then file into <code>YYYY/MM/</code>.</p>

  <p>Cleaned text and tags are the default view. Retry cleanup if ollanet was unreachable; Skip leaves the raw transcript. Holding notes can File, File as copy, or Unfile.</p>

  <p>Search the inbox by words, tags, or filename. First-run problems: <code>pnpm run doctor</code>.</p>
</aside>

<style lang="scss">
  label {
    font-size: 3rem;
    position: absolute;
    top: 2px;
    right: 3px;
    z-index: 5;
    cursor: pointer;
    background-color: black;
    border-radius: 10px;
  }

  input[type='checkbox'] {
    position: absolute;
    top: -100px;
  }

  aside {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    transform: translateX(100%);
    transition: 0.3s all ease-out;
    background-color: #efefef;
    padding: 1rem;
  }

  aside p {
    font-size: 1.2rem;
    margin: 0.5rem 0;
  }

  aside code {
    font-size: 0.95em;
  }

  /* Toggled State of information box */
  input[type='checkbox']:checked ~ aside {
    transform: translateX(0);
  }
</style>
