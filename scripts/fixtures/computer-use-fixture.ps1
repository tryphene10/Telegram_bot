$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework

$window = New-Object System.Windows.Window
$window.Title = 'ARCC Computer Use Fixture'
$window.Name = 'ArccComputerUseFixture'
$window.Width = 520
$window.Height = 240
$window.WindowStartupLocation = 'CenterScreen'

$panel = New-Object System.Windows.Controls.StackPanel
$panel.Margin = New-Object System.Windows.Thickness(30)

$taskInput = New-Object System.Windows.Controls.TextBox
$taskInput.Name = 'TaskInput'
$taskInput.Text = 'fixture-ready'
$taskInput.Height = 30
$taskInput.Margin = New-Object System.Windows.Thickness(0, 0, 0, 20)

$button = New-Object System.Windows.Controls.Button
$button.Name = 'ApplyButton'
$button.Content = 'Apply'
$button.Width = 120
$button.Height = 40
$button.HorizontalAlignment = 'Left'

$status = New-Object System.Windows.Controls.TextBlock
$status.Name = 'StatusLabel'
$status.Text = 'WAITING'
$status.FontSize = 18
$status.Margin = New-Object System.Windows.Thickness(0, 20, 0, 0)

$button.Add_Click({ $status.Text = 'APPLIED' })
[void]$panel.Children.Add($taskInput)
[void]$panel.Children.Add($button)
[void]$panel.Children.Add($status)
$window.Content = $panel
$window.Add_ContentRendered({ $window.Activate() })
[void]$window.ShowDialog()
