# Elevator Music

## Volume Ducking

Elevator music plays at 30% volume by default.

When browser TTS playback is active, elevator music ducks to 10% volume so spoken messages stay clear. Once browser TTS playback finishes or is stopped, elevator music returns to 30% volume.

The ducking signal comes from the shared browser playback store, not from server message status alone. This means volume changes follow local browser speech playback.

## Play/Pause Behavior

The Play/Pause control preserves playback position.

Pausing elevator music pauses the existing audio element without resetting `currentTime`. Pressing Play again resumes that same audio element from the paused position.

The audio position is reset only when the elevator music provider is torn down, such as when the app unmounts.

## Keep screen awake

Audio playback alone does not prevent a phone from sleeping. While elevator music is playing, the app requests a screen wake lock. Pausing elevator music releases the lock. If the wake lock is unavailable or fails, elevator music still plays.
