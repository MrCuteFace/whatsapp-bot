using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.Data.SqlClient;

namespace whatsapp_bot_user_management
{
    public partial class AddUserWindow : Window
    {
        public bool AnyUserAdded { get; private set; }

        public AddUserWindow()
        {
            InitializeComponent();
        }

        private (CheckBox Check, TextBlock Result, RoleOption Role)[] RoleRows => new[]
        {
            (ShippingAgentCheck, ShippingAgentResult, RoleOption.All[0]),
            (ForwarderCheck, ForwarderResult, RoleOption.All[1]),
            (CustomsBrokerCheck, CustomsBrokerResult, RoleOption.All[2]),
        };

        private void ResetCheck(object sender, RoutedEventArgs e)
        {
            foreach (var row in RoleRows)
            {
                row.Result.Text = "";
            }
        }

        private async void AddButton_Click(object sender, RoutedEventArgs e)
        {
            var phone = PhoneBox.Text.Trim();
            var name = NameBox.Text.Trim();
            var hp = HpBox.Text.Trim();
            var selectedRows = RoleRows.Where(r => r.Check.IsChecked == true).ToArray();

            if (phone.Length == 0 || name.Length == 0)
            {
                ShowStatus("נא למלא טלפון ושם", isError: true);
                return;
            }
            if (hp.Length == 0)
            {
                ShowStatus("נא להזין ח.פ", isError: true);
                return;
            }
            if (selectedRows.Length == 0)
            {
                ShowStatus("נא לבחור לפחות תפקיד אחד", isError: true);
                return;
            }

            AddButton.IsEnabled = false;
            try
            {
                using var connection = new SqlConnection(DbConfig.ConnectionString);
                await connection.OpenAsync();

                using (var existsCommand = new SqlCommand(
                    "SELECT TOP 1 1 FROM [BotDb].[dbo].[user_roles] WHERE phone = @phone",
                    connection))
                {
                    existsCommand.Parameters.AddWithValue("@phone", phone);
                    if (await existsCommand.ExecuteScalarAsync() is not null)
                    {
                        ShowStatus("מספר זה כבר רשום במערכת. יש למחוק את הרשומה הקיימת לפני הוספה מחדש", isError: true);
                        return;
                    }
                }

                var allMatched = true;
                foreach (var row in selectedRows)
                {
                    using var command = new SqlCommand(
                        "SELECT TOP 1 short_name_he FROM [BotDb].[dbo].[customers] WHERE customer_id = @hp AND client_type = @clientType",
                        connection);
                    command.Parameters.AddWithValue("@hp", hp);
                    command.Parameters.AddWithValue("@clientType", row.Role.ClientType);

                    var result = await command.ExecuteScalarAsync();
                    if (result is string companyName)
                    {
                        row.Result.Text = $"נמצא: {companyName}";
                        row.Result.Foreground = Brushes.Green;
                    }
                    else
                    {
                        row.Result.Text = "לא נמצאה חברה עם ח.פ ותפקיד אלו";
                        row.Result.Foreground = Brushes.Red;
                        allMatched = false;
                    }
                }

                if (!allMatched)
                {
                    ShowStatus("ח.פ לא תקין עבור חלק מהתפקידים, בדוק ותקן", isError: true);
                    return;
                }

                // Phone was already confirmed unregistered above, so the first
                // selected role is active and the rest aren't - no DB-side guessing needed.
                for (var i = 0; i < selectedRows.Length; i++)
                {
                    var row = selectedRows[i];
                    using var command = new SqlCommand(
                        """
                        INSERT INTO [BotDb].[dbo].[user_roles] (phone, role, name, hp, is_active)
                        VALUES (@phone, @role, @name, @hp, @isActive)
                        """,
                        connection);
                    command.Parameters.AddWithValue("@phone", phone);
                    command.Parameters.AddWithValue("@role", row.Role.Slug);
                    command.Parameters.AddWithValue("@name", name);
                    command.Parameters.AddWithValue("@hp", hp);
                    command.Parameters.AddWithValue("@isActive", i == 0 ? 1 : 0);

                    await command.ExecuteNonQueryAsync();
                }

                AnyUserAdded = true;
                ShowStatus($"המשתמש {name} נוסף בהצלחה עם {selectedRows.Length} תפקיד/ים", isError: false);
                PhoneBox.Clear();
                NameBox.Clear();
                HpBox.Clear();
                foreach (var row in RoleRows)
                {
                    row.Check.IsChecked = false;
                }
            }
            catch (Exception ex)
            {
                ShowStatus($"שגיאה בהוספה: {ex.Message}", isError: true);
            }
            finally
            {
                AddButton.IsEnabled = true;
            }
        }

        private void ShowStatus(string text, bool isError)
        {
            StatusText.Text = text;
            StatusText.Foreground = isError ? Brushes.Red : Brushes.Green;
        }
    }
}
