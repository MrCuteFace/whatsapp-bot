using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.Data.SqlClient;

namespace whatsapp_bot_user_management
{
    public partial class MainWindow : Window
    {
        private readonly ObservableCollection<UserRoleRecord> _users = new();

        public MainWindow()
        {
            InitializeComponent();
            UsersGrid.ItemsSource = _users;
            _ = LoadUsersAsync();
        }

        private async Task LoadUsersAsync()
        {
            try
            {
                using var connection = new SqlConnection(DbConfig.ConnectionString);
                await connection.OpenAsync();

                using var command = new SqlCommand(
                    """
                    SELECT ur.phone, ur.role, ur.name, ur.hp,
                      (SELECT TOP 1 c.short_name_he
                       FROM [BotDb].[dbo].[customers] c
                       WHERE c.customer_id = ur.hp
                         AND c.client_type = CASE ur.role
                           WHEN 'shipping_agent' THEN N'סוכן אוניה'
                           WHEN 'forwarder' THEN N'משלח'
                           WHEN 'customs_broker' THEN N'עמיל מכס'
                         END
                      ) AS company_name
                    FROM [BotDb].[dbo].[user_roles] ur
                    ORDER BY ur.phone, ur.role
                    """,
                    connection);
                using var reader = await command.ExecuteReaderAsync();

                var rows = new List<(string Phone, string Role, string Name, string Hp, string CompanyName)>();
                while (await reader.ReadAsync())
                {
                    rows.Add((
                        reader.GetString(0),
                        reader.GetString(1),
                        reader.IsDBNull(2) ? "" : reader.GetString(2),
                        reader.IsDBNull(3) ? "" : reader.GetString(3),
                        reader.IsDBNull(4) ? "" : reader.GetString(4)));
                }

                _users.Clear();
                foreach (var group in rows.GroupBy(r => r.Phone))
                {
                    var first = group.First();
                    var rolesLabel = string.Join(", ",
                        group.Select(r => RoleOption.All.FirstOrDefault(o => o.Slug == r.Role)?.ClientType ?? r.Role));
                    _users.Add(new UserRoleRecord
                    {
                        Phone = first.Phone,
                        Name = first.Name,
                        Hp = first.Hp,
                        CompanyName = first.CompanyName,
                        RolesLabel = rolesLabel,
                    });
                }
                DeleteButton.IsEnabled = false;
                ShowStatus($"{_users.Count} משתמשים", isError: false);
            }
            catch (Exception ex)
            {
                ShowStatus($"שגיאה בטעינה: {ex.Message}", isError: true);
            }
        }

        private async void AddUserButton_Click(object sender, RoutedEventArgs e)
        {
            var addWindow = new AddUserWindow { Owner = this };
            addWindow.ShowDialog();
            if (addWindow.AnyUserAdded)
            {
                await LoadUsersAsync();
            }
        }

        private void UsersGrid_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            DeleteButton.IsEnabled = UsersGrid.SelectedItems.Count > 0;
        }

        private async void DeleteButton_Click(object sender, RoutedEventArgs e)
        {
            var selected = UsersGrid.SelectedItems.Cast<UserRoleRecord>().ToArray();
            if (selected.Length == 0) return;

            var confirm = MessageBox.Show(
                $"למחוק {selected.Length} משתמשים (כולל כל התפקידים שלהם)?",
                "אישור מחיקה",
                MessageBoxButton.YesNo,
                MessageBoxImage.Warning);
            if (confirm != MessageBoxResult.Yes) return;

            DeleteButton.IsEnabled = false;
            try
            {
                using var connection = new SqlConnection(DbConfig.ConnectionString);
                await connection.OpenAsync();

                foreach (var user in selected)
                {
                    using var command = new SqlCommand(
                        "DELETE FROM [BotDb].[dbo].[user_roles] WHERE phone = @phone",
                        connection);
                    command.Parameters.AddWithValue("@phone", user.Phone);
                    await command.ExecuteNonQueryAsync();
                }

                ShowStatus($"{selected.Length} משתמשים נמחקו", isError: false);
                await LoadUsersAsync();
            }
            catch (Exception ex)
            {
                ShowStatus($"שגיאה במחיקה: {ex.Message}", isError: true);
            }
        }

        private async void RefreshButton_Click(object sender, RoutedEventArgs e) => await LoadUsersAsync();

        private void ShowStatus(string text, bool isError)
        {
            StatusText.Text = text;
            StatusText.Foreground = isError ? Brushes.Red : Brushes.Green;
        }
    }
}
