import type { ScopedLogger } from '../logging/logger'

export function playNotificationSound(soundPath: string, logger: ScopedLogger): void {
  const script = [
    'Add-Type -AssemblyName presentationCore',
    '$player = New-Object System.Windows.Media.MediaPlayer',
    `$player.Open([Uri] '${escapePowerShellString(soundPath)}')`,
    '$player.Volume = 1.0',
    '$player.Play()',
    'Start-Sleep -Milliseconds 2500',
  ].join('; ')

  const proc = Bun.spawn([
    'powershell.exe',
    '-NoProfile',
    '-WindowStyle',
    'Hidden',
    '-Command',
    script,
  ], {
    stdout: 'ignore',
    stderr: 'pipe',
  })

  void proc.exited.then(async (exitCode) => {
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      logger.warn('Notification sound playback failed', {
        exitCode,
        stderr: stderr.trim(),
        soundPath,
      })
    }
  })
}

function escapePowerShellString(value: string): string {
  return value.replaceAll('\'', '\'\'')
}
