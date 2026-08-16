<label for="toggle">❔</label>
<input type="checkbox" id="toggle" />
<aside>
  <h2>Information</h2>

  <p>
    Web dictaphone is built using <a href="https://developer.mozilla.org/en-US/docs/Web/API/Navigator.getUserMedia"
      >getUserMedia</a
    >
    and the <a href="https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder_API">MediaRecorder API</a>, which
    provides an easier way to capture Media streams.
  </p>

  <p>
    Icon courtesy of <a href="http://findicons.com/search/microphone">Find Icons</a>. Thanks to
    <a href="http://soledadpenades.com/">Sole</a> for the Oscilloscope code!
  </p>
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

  aside a {
    color: #666;
  }

  /* Toggled State of information box */
  input[type='checkbox']:checked ~ aside {
    transform: translateX(0);
  }
</style>
